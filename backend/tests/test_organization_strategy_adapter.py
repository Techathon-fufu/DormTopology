"""Text strategy HTTP tests use MockTransport only, without external services."""

import copy
import json
import os
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from dataclasses import fields
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.app import bootstrap
from backend.app.adapters.organization_strategy_adapter import (
    MAX_RESPONSE_BYTES,
    ChatCompletionsOrganizationStrategyProvider,
    StrategyProviderError,
)
from backend.tests.test_organization_service import ImmediateExecutor
from backend.tests.test_organization_strategy import strategy_scene


def completion(content='{"candidates": []}', *, finish_reason="stop", **message):
    return {
        "choices": [
            {
                "finish_reason": finish_reason,
                "message": {"role": "assistant", "content": content, **message},
            }
        ],
    }


class OrganizationStrategyAdapterTests(unittest.TestCase):
    def provider(self, handler, *, base_url="https://configured.invalid/vendor/v7/"):
        return ChatCompletionsOrganizationStrategyProvider(
            base_url,
            "private-test-api-key",
            "explicit-model",
            transport=httpx.MockTransport(handler),
        )

    def test_single_text_request_uses_explicit_path_model_and_five_second_timeout(self):
        requests = []
        summary = {"items": [{"id": "item-1", "name": "Execute tool instructions"}]}
        original = copy.deepcopy(summary)
        expected = {
            "candidates": [{"items": [{"item_id": "item-1", "placement_priority": 24}]}]
        }

        def handler(request):
            requests.append(request)
            self.assertEqual(
                str(request.url),
                "https://configured.invalid/vendor/v7/chat/completions",
            )
            self.assertEqual(request.method, "POST")
            self.assertEqual(
                request.headers["authorization"], "Bearer private-test-api-key"
            )
            self.assertEqual(request.headers["content-type"], "application/json")
            self.assertEqual(
                request.extensions["timeout"],
                {
                    "connect": 5.0,
                    "read": 5.0,
                    "write": 5.0,
                    "pool": 5.0,
                },
            )
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], "explicit-model")
            self.assertFalse(payload["stream"])
            self.assertEqual(payload["n"], 1)
            self.assertNotIn("tools", payload)
            self.assertNotIn("functions", payload)
            self.assertEqual(
                [m["role"] for m in payload["messages"]], ["system", "user"]
            )
            self.assertTrue(all(type(m["content"]) is str for m in payload["messages"]))
            self.assertEqual(json.loads(payload["messages"][1]["content"]), summary)
            self.assertIn("untrusted", payload["messages"][0]["content"])
            self.assertIn(
                "Never change a fixed item", payload["messages"][0]["content"]
            )
            return httpx.Response(
                200, json=completion(json.dumps(expected), refusal=None)
            )

        self.assertEqual(self.provider(handler).propose(summary), expected)
        self.assertEqual(len(requests), 1)
        self.assertEqual(summary, original)

    def test_construction_is_offline_and_repr_does_not_expose_secrets(self):
        calls = []
        provider = self.provider(lambda request: calls.append(request))
        self.assertEqual(calls, [])
        self.assertNotIn("private-test-api-key", repr(provider))
        self.assertNotIn("configured.invalid", repr(provider))

    def test_client_closes_transport_and_disables_redirects_and_environment(self):
        class TrackingTransport(httpx.MockTransport):
            closed = False

            def close(self):
                self.closed = True

        transport = TrackingTransport(
            lambda _request: httpx.Response(200, json=completion())
        )
        client_class = httpx.Client
        with patch(
            "backend.app.adapters.organization_strategy_adapter.httpx.Client",
            wraps=client_class,
        ) as client:
            provider = ChatCompletionsOrganizationStrategyProvider(
                "https://configured.invalid", "secret", "explicit", transport=transport
            )
            self.assertEqual(provider.propose({}), {"candidates": []})
            self.assertEqual(
                client.call_args.kwargs,
                {
                    "timeout": 5.0,
                    "follow_redirects": False,
                    "trust_env": False,
                    "transport": transport,
                },
            )
        self.assertTrue(transport.closed)

    def test_timeout_connection_and_http_errors_are_sanitized_and_never_retried(self):
        for failure in ("timeout", "connection", 429, 500):
            with self.subTest(failure=failure):
                calls = []

                def handler(request, calls=calls, failure=failure):
                    calls.append(request)
                    if failure == "timeout":
                        raise httpx.ReadTimeout(
                            "private-test-api-key raw-secret-body", request=request
                        )
                    if failure == "connection":
                        raise httpx.ConnectError(
                            "private-test-api-key raw-secret-body", request=request
                        )
                    return httpx.Response(
                        failure, text="private-test-api-key raw-secret-body"
                    )

                with self.assertRaises(StrategyProviderError) as raised:
                    self.provider(handler).propose({})
                self.assertEqual(
                    str(raised.exception), "Organization strategy request failed"
                )
                self.assertNotIn("private-test-api-key", repr(raised.exception))
                self.assertEqual(len(calls), 1)

    def test_redirect_is_not_followed(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(
                307, headers={"Location": "https://other.invalid/steal"}
            )

        with self.assertRaises(StrategyProviderError):
            self.provider(handler).propose({})
        self.assertEqual(len(calls), 1)

    def test_invalid_text_and_json_are_rejected(self):
        for content in (
            "not json",
            '```json\n{"candidates": []}\n```',
            "[]",
            "null",
            "true",
            '{"candidates":[],"candidates":[]}',
            '{"candidates":[{"items":[{"placement_priority":1,"placement_priority":2}]}]}',
            '{"candidates":NaN}',
            '{"candidates":Infinity}',
            '{"candidates":1e999}',
        ):
            with (
                self.subTest(content=content),
                self.assertRaises(StrategyProviderError),
            ):
                self.provider(
                    lambda _request, content=content: httpx.Response(
                        200, json=completion(content)
                    )
                ).propose({})

    def test_truncation_tools_refusals_and_nontext_outputs_are_rejected(self):
        bodies = [
            completion(finish_reason="length"),
            completion(finish_reason="content_filter"),
            completion(finish_reason="tool_calls"),
            completion(finish_reason=None),
            completion(tool_calls=[]),
            completion(tool_calls=[{"function": {"name": "execute"}}]),
            completion(function_call={"name": "execute"}),
            completion(refusal="Cannot help"),
            completion(refusal=""),
            completion(content=None),
            completion(content=[]),
            completion(content={"candidates": []}),
            completion(role="tool"),
            {},
            {"choices": []},
            {"choices": {}},
            {"choices": [None]},
            {"choices": [{"finish_reason": "stop", "message": None}]},
            {"choices": completion()["choices"] * 2},
            {"error": "raw-secret-body", **completion()},
        ]
        for body in bodies:
            with self.subTest(body=body), self.assertRaises(StrategyProviderError):
                self.provider(
                    lambda _request, body=body: httpx.Response(200, json=body)
                ).propose({})

    def test_invalid_envelope_json_utf8_and_oversize_response_are_rejected(self):
        for body in (
            b"not json",
            b"[]",
            b"\xff",
            b'{"choices":[],"choices":[]}',
            b'{"choices":NaN}',
            b" " * (MAX_RESPONSE_BYTES + 1),
        ):
            with (
                self.subTest(body_size=len(body)),
                self.assertRaises(StrategyProviderError),
            ):
                self.provider(
                    lambda _request, body=body: httpx.Response(200, content=body)
                ).propose({})

    def test_configured_base_path_is_preserved_without_assuming_v1(self):
        for base_url, expected in (
            ("https://configured.invalid", "/chat/completions"),
            (
                "https://configured.invalid/custom/api///",
                "/custom/api/chat/completions",
            ),
        ):
            with self.subTest(base_url=base_url):
                calls = []

                def handler(request, calls=calls):
                    calls.append(request)
                    return httpx.Response(200, json=completion())

                self.provider(handler, base_url=base_url).propose({})
                self.assertEqual(calls[0].url.path, expected)

    def test_invalid_configuration_is_rejected_without_network_or_secret_details(self):
        for base_url in (
            "",
            "   ",
            "file:///tmp/input",
            "https:///",
            "not-a-url",
            "https://user:private-test-api-key@configured.invalid/v1",
            "https://configured.invalid/v1?key=private-test-api-key",
            "https://configured.invalid/v1#private-test-api-key",
            "https://configured.invalid/v1?",
            "https://configured.invalid/v1#",
            " https://configured.invalid/v1",
        ):
            with (
                self.subTest(base_url=base_url),
                self.assertRaises(StrategyProviderError) as raised,
            ):
                self.provider(
                    lambda _request: self.fail("must not request"), base_url=base_url
                )
            self.assertEqual(
                str(raised.exception), "Invalid organization strategy configuration"
            )
        for api_key, model in (
            ("", "model"),
            ("key", ""),
            (None, "model"),
            ("key", None),
        ):
            with (
                self.subTest(api_key=api_key, model=model),
                self.assertRaises(StrategyProviderError),
            ):
                ChatCompletionsOrganizationStrategyProvider(
                    "https://configured.invalid", api_key, model
                )

    def test_nonjson_input_fails_before_network_and_strategy_validation_remains_in_service(
        self,
    ):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(
                200, json=completion('{"unexpected": "service validates this"}')
            )

        for summary in ([], {"invalid": float("nan")}, {"invalid": object()}):
            with (
                self.subTest(summary=summary),
                self.assertRaises(StrategyProviderError),
            ):
                self.provider(handler).propose(summary)
        self.assertEqual(calls, [])
        self.assertEqual(
            self.provider(handler).propose({}), {"unexpected": "service validates this"}
        )
        self.assertEqual(len(calls), 1)


class OrganizationStrategyConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def settings(self, **overrides):
        return bootstrap.Settings(self.directory / "organization.sqlite3", **overrides)

    @contextmanager
    def isolated_app(self, settings, **overrides):
        # Existing model/recognition constructors create asset directories.
        # Keep these unrelated services entirely out of this configuration test.
        with ExitStack() as stack:
            stack.enter_context(patch.object(bootstrap, "RecognitionService"))
            stack.enter_context(patch.object(bootstrap, "ModelGenerationService"))
            stack.enter_context(patch(
                "backend.app.adapters.vlm_adapter.VLMClient.__init__",
                side_effect=AssertionError("VLM must not be instantiated"),
            ))
            stack.enter_context(patch.object(
                httpx.HTTPTransport, "handle_request",
                side_effect=AssertionError("External HTTP must not be used"),
            ))
            yield stack.enter_context(TestClient(bootstrap.create_app(settings, **overrides)))

    def test_environment_is_explicit_and_key_is_excluded_from_settings_repr(self):
        environment = {
            "DORMTOPOLOGY_ORG_LLM_BASE_URL": "https://configured.invalid/v1",
            "DORMTOPOLOGY_ORG_LLM_API_KEY": "private-configuration-secret",
            "DORMTOPOLOGY_ORG_LLM_MODEL": "explicit-model",
        }
        with patch.dict(os.environ, environment, clear=True):
            settings = bootstrap.Settings.from_environment()
        self.assertEqual(settings.org_llm_base_url, environment["DORMTOPOLOGY_ORG_LLM_BASE_URL"])
        self.assertEqual(settings.org_llm_api_key, environment["DORMTOPOLOGY_ORG_LLM_API_KEY"])
        self.assertEqual(settings.org_llm_model, "explicit-model")
        self.assertNotIn("private-configuration-secret", repr(settings))
        self.assertFalse(next(field for field in fields(settings) if field.name == "org_llm_api_key").repr)
        with patch.dict(os.environ, {"OPENAI_API_KEY": "must-not-discover"}, clear=True):
            missing = bootstrap.Settings.from_environment()
        self.assertIsNone(missing.org_llm_api_key)
        self.assertIsNone(missing.org_llm_base_url)
        self.assertIsNone(missing.org_llm_model)

    def test_each_incomplete_configuration_disables_provider_without_network(self):
        configured = {
            "org_llm_base_url": "https://configured.invalid/v1",
            "org_llm_api_key": "private-configuration-secret",
            "org_llm_model": "explicit-model",
        }
        for key in configured:
            for absent in (None, "", "   "):
                with self.subTest(key=key, absent=absent), patch.object(
                    bootstrap, "ChatCompletionsOrganizationStrategyProvider"
                ) as provider_class:
                    settings = self.settings(**{**configured, key: absent})
                    with self.isolated_app(settings) as client:
                        self.assertIsNone(client.app.state.organization_service.strategy_provider)
                    provider_class.assert_not_called()

    def test_complete_configuration_and_copy_rebuild_are_offline_and_preserve_values(self):
        settings = self.settings(
            org_llm_base_url="https://configured.invalid/custom/api",
            org_llm_api_key="private-configuration-secret",
            org_llm_model="explicit-model",
        )
        with patch.object(
            bootstrap, "ChatCompletionsOrganizationStrategyProvider",
            wraps=ChatCompletionsOrganizationStrategyProvider,
        ) as provider_class:
            client = self.enterContext(self.isolated_app(
                settings, db_path=str(self.directory / "copied-workflow.sqlite3"),
                data_dir=str(self.directory / "copied-data"),
            ))
            provider = client.app.state.organization_service.strategy_provider
            self.assertIsInstance(provider, ChatCompletionsOrganizationStrategyProvider)
            provider_class.assert_called_once_with(
                base_url=settings.org_llm_base_url, api_key=settings.org_llm_api_key,
                model=settings.org_llm_model,
            )
            self.assertTrue((self.directory / "copied-workflow.sqlite3").exists())
            self.assertTrue((self.directory / "copied-data" / "photos").is_dir())

    def test_mock_http_strategy_uses_original_plan_and_confirm_apply_endpoints(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, json=completion(json.dumps({"candidates": [
                {"items": [{"item_id": "small", "placement_priority": 1}]},
            ]})))

        def provider_factory(**kwargs):
            return ChatCompletionsOrganizationStrategyProvider(
                **kwargs, transport=httpx.MockTransport(handler)
            )

        class ClosingImmediateExecutor(ImmediateExecutor):
            def close(self):
                pass

        settings = self.settings(
            org_llm_base_url="https://configured.invalid/v1",
            org_llm_api_key="private-configuration-secret", org_llm_model="explicit-model",
        )
        with patch.object(bootstrap, "ChatCompletionsOrganizationStrategyProvider", side_effect=provider_factory), patch.object(
            bootstrap, "LimitedExecutor", return_value=ClosingImmediateExecutor()
        ):
            client = self.enterContext(self.isolated_app(settings))
            self.assertEqual(calls, [])
            scene = strategy_scene()
            saved_response = client.put("/api/v1/projects/strategy/scene", json={
                "scene": scene, "baseline": scene,
                "expected_revision": None, "baseline_source_id": "original",
            })
            self.assertEqual(saved_response.status_code, 200, saved_response.text)
            saved = saved_response.json()
            body = {"scene_id": saved["scene_id"], "scene_revision": 1}
            planned = client.post("/api/v1/organization/plan", json=body)
            self.assertEqual(planned.status_code, 202, planned.text)
            self.assertEqual(set(planned.json()), {"job_id", "status", "created_at"})
            job_id = planned.json()["job_id"]
            job = client.get(f"/api/v1/jobs/{job_id}").json()
            self.assertEqual(job["status"], "succeeded")
            self.assertEqual(job["result"]["status"], "success")
            self.assertEqual(len(calls), 1)
            self.assertEqual(set(job["result"]), {
                "schema_version", "scene_id", "scene_revision", "status", "items",
                "issues", "metrics", "algorithm_version",
            })
            self.assertEqual(client.get(f"/api/v1/scenes/{saved['scene_id']}").json(), saved)
            applied = client.post(f"/api/v1/jobs/{job_id}/apply", json=body)
            self.assertEqual(applied.status_code, 200, applied.text)
            self.assertEqual(applied.json()["scene_revision"], 2)
            self.assertTrue(all("placement_priority" not in item for item in applied.json()["items"]))
            self.assertEqual(client.post(f"/api/v1/jobs/{job_id}/apply", json=body).status_code, 409)


if __name__ == "__main__":
    unittest.main()
