# 快速开始 (/zh/get-started/quick-start)



## 准备工作 [#准备工作]

先在 [API 控制台](https://hyper3d.ai/workspace/api-dashboard)创建 API key。

<Callout type="error" title="不要在代码中保留凭据">
  切勿将 API key 或其他凭据硬编码到代码中或提交到代码仓库。请改用环境变量或密钥管理服务加载凭据，例如：

  ```bash
  export RODIN_API_KEY='replace-with-your-api-key'
  ```
</Callout>

所有受保护的请求都使用以下请求头：

```http
Authorization: Bearer YOUR_RODIN_API_KEY
```

## 1. 提交生成任务 [#1-提交生成任务]

下面的示例向 Rodin Gen-2.5 提交一张图片。最多可上传五张图片；多图请求需要重复提交 `images` 表单字段。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'images=@./input.png' \
  --form 'tier=Gen-2.5-Medium' \
  --form 'mesh_mode=Raw' \
  --form 'quality=medium'

```

响应中有两个用途不同的标识：

* `jobs.subscription_key`：传给 `/status`。
* 顶层 `uuid`：作为 `task_uuid` 传给 `/download`。

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

## 2. 查询状态 [#2-查询状态]

首次查询前至少等待 5 秒，后续请求逐步退避；收到 HTTP 429 时遵循 `Retry-After`。任一 job 为 `Failed` 时立即停止；仅当所有 job 都为 `Done` 时进入下载步骤。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/status' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"subscription_key":"subscription-key-from-generation-response"}'

```

## 3. 下载结果 [#3-下载结果]

全部 job 完成后，使用生成响应顶层的 `uuid` 调用 `/download`。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/download' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"task_uuid":"123e4567-e89b-12d3-a456-426614174000"}'

```

## 完整 Python 流程 [#完整-python-流程]

这个示例在 5 秒后开始轮询，逐步增加到最长 30 秒的间隔，总期限为 20 分钟；它会处理 HTTP 429、在 job 失败时终止，并且只在全部完成后下载。

```python
import os
import time
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

BASE_URL = "https://api.hyper3d.com/api/v2"
DEADLINE_SECONDS = 20 * 60


def request_with_rate_limit(session, method, url, **kwargs):
    while True:
        response = session.request(method, url, timeout=60, **kwargs)
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()

        retry_after = response.headers.get("Retry-After", "5")
        try:
            delay = max(1, int(retry_after))
        except ValueError:
            delay = max(1, int((parsedate_to_datetime(retry_after) - parsedate_to_datetime(response.headers["Date"])).total_seconds()))
        time.sleep(delay)


session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ['RODIN_API_KEY']}"

with Path("input.png").open("rb") as image_file:
    generation = request_with_rate_limit(
        session,
        "POST",
        f"{BASE_URL}/rodin",
        files={"images": ("input.png", image_file, "image/png")},
        data={"tier": "Gen-2.5-Medium", "mesh_mode": "Raw", "quality": "medium"},
    )

subscription_key = generation["jobs"]["subscription_key"]
task_uuid = generation["uuid"]
started_at = time.monotonic()
delay = 5

while True:
    if time.monotonic() - started_at >= DEADLINE_SECONDS:
        raise TimeoutError("Generation did not finish within 20 minutes")
    time.sleep(delay)
    status = request_with_rate_limit(
        session,
        "POST",
        f"{BASE_URL}/status",
        json={"subscription_key": subscription_key},
    )
    states = [job["status"] for job in status["jobs"]]
    if "Failed" in states:
        raise RuntimeError(f"Generation failed: {status}")
    if states and all(state == "Done" for state in states):
        break
    delay = min(delay + 5, 30)

downloads = request_with_rate_limit(
    session,
    "POST",
    f"{BASE_URL}/download",
    json={"task_uuid": task_uuid},
)
print(downloads)

```

## 下一步 [#下一步]

* [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5)
* [查询状态](/zh/api-specification/check-status)
* [下载结果](/zh/api-specification/download-results)
* [查询余额](/zh/api-specification/check-balance)
# 核心概念 (/zh/get-started/features)



## 请求流程 [#请求流程]

Rodin 采用异步生成流程：

1. 向 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5)、[Rodin Gen-2](/zh/api-specification/rodin-gen2)或 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5)提交任务。
2. 使用 `jobs.subscription_key` 调用[查询状态](/zh/api-specification/check-status)，直到所有 job 完成。
3. 使用生成响应顶层的 `uuid` 调用[下载结果](/zh/api-specification/download-results)。

[快速开始](/zh/get-started/quick-start)提供了包含退避、失败处理和总期限的完整实现。

## 生成模型系列 [#生成模型系列]

### Rodin Gen-2.5 [#rodin-gen-25]

支持 Image-to-3D、Text-to-3D、多种 tier、网格参数、纹理参数和 Add-ons。准确的 enum 值与默认值以页面中的 OpenAPI 展示为准。

### Rodin Gen-2 [#rodin-gen-2]

支持 Image-to-3D 和 Text-to-3D，以及 Gen-2 对应的网格、材质、纹理和 Add-on 参数。

### Rodin Gen-1/1.5 [#rodin-gen-115]

支持 `Sketch`、`Regular`、`Detail` 和 `Smooth` tier，以及多图 `concat` 与 `fuse` 行为。

## Credits 与计费 [#credits-与计费]

每次成功受理的提交都会通过 `consumed` 返回本次消耗的 credits，[查询余额](/zh/api-specification/check-balance)则返回账户剩余的 credits。由于并发任务会消耗同一份余额，返回的余额应视为某一时刻的读数，而不是预留额度。

各 tier 的价格与 credit 单价以[官方定价页](https://hyper3d.ai/pricing?lang=en)为准，可能独立于本文档变化。提交付费任务前请先在该页面确认当前价格。

账户同时还有并发任务数量上限。超出该上限时提交会被拒绝并返回 `API_PARALLELISM_LIMIT_REACHED`，可在已有任务完成后重试。完整错误码列表和限流行为参见[错误码](/zh/api-specification/errors)。
# 更新日志 (/zh/get-started/changelog)



Rodin API 最新功能与更新。

## 2026 年 9 月 [#2026-年-9-月]

* 新文档：新增 [Rodin Agentic](/zh/api-specification/rodin-agentic) API 文档。
* 新增参数: 为 [Bang](/zh/api-specification/bang) 新增 `quality_override` 和 `mesh_mode` 参数。

## 2026 年 8 月 [#2026-年-8-月]

* 更新文档：在 [生成纹理](/zh/api-specification/generate-texture) 页面补充了 [纹理分辨率对照表](/zh/api-specification/generate-texture#贴图分辨率)并更新了 [计费](/zh/api-specification/generate-texture#计费)。
* 新增参数: 为 [Bang](/zh/api-specification/bang) 新增 `instruction` 参数。
* 新增参数: 为 [生成纹理](/zh/api-specification/generate-texture) 新增 `hd_texture`, `texture_delight`, `texture_mode` 参数。
* 新增参数: 为 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 新增 `image_label`, `is_symmetric`, `soft`, `detail_level` and `quad_normal` 参数。
* 新增参数：为 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 新增 `image_label` 与 `is_symmetric` 参数。
* 更新文档：在 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 页面补充了 [纹理分辨率对照表](/zh/api-specification/rodin-gen2-5#贴图分辨率)。
* 更新参数：更新了 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5)、[Rodin Gen-2](/zh/api-specification/rodin-gen2) 与 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 的 Add-ons 定价。提交付费任务前，请以官方定价页公布的最新 credit 价格为准。
* 新增参数：为 [查询余额](/zh/api-specification/check-balance) 新增可选请求参数 `usage_page` 与响应字段 `usage`。未传入 `usage_page` 时，响应中不包含 `usage`。

## 2026 年 7 月 [#2026-年-7-月]

* 将所有 API 文档迁移到[新 Hyper3D API 文档](https://docs.hyper3d.ai/zh)。
* 更新参数：将 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 的 `geometry_instruct_mode` 默认值从 `faithful` 改为 `creative`。

## 2026 年 6 月 [#2026-年-6-月]

* 完善提示：[Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 上的 `geometry_instruct_mode=creative` 仅可用于 `Gen-2.5-Medium` 及更高 tier。

## 2026 年 5 月 [#2026-年-5-月]

* 新增文档：新增 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) API 文档。
* 完善提示：更新了 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5) 的 `quality_override` 范围说明。
* 更新参数：将 Gen-2、Gen-1/1.5 与快速开始文档中的 `images` 参数结构从字典改为列表，以匹配实际 API 行为。

## 2026 年 4 月 [#2026-年-4-月]

* 新增参数：为 `material` 参数新增 `None` 取值（生成无材质资产）。当前支持值为 `PBR`、`Shaded`、`All` 与 `None`。

## 2026 年 3 月 [#2026-年-3-月]

* 新增文档：新增 [Rodin 3ds Max Add-on](/zh/addons/3dsmax-addon) 文档。
* 新增参数：为 [Rodin Gen-2](/zh/api-specification/rodin-gen2) 新增 `hd_texture` 参数。设为 `true` 时生成高质量纹理，默认为 `false`。

## 2026 年 2 月 [#2026-年-2-月]

* 更新文档：更新了 [Bang](/zh/api-specification/bang) 自定义模型工作流：当提供自定义模型时，`image` 现为必填（此前仅用于纹理生成，为可选）。`prompt` 仍为可选。

## 2025 年 11 月 [#2025-年-11-月]

* 新增文档：新增 [Bang](/zh/api-specification/bang) API 文档。

## 2025 年 10 月 [#2025-年-10-月]

* 新增文档：新增 [Rodin Maya Add-on](/zh/addons/maya-addon) 文档。

## 2025 年 9 月 [#2025-年-9-月]

* 新增文档：新增 [Rodin Cinema 4D Add-on](/zh/addons/c4d-addon) 文档。
* 完善提示：更新了 Gen-2 与 Gen-1/1.5 生成文档中 `quality` 参数的描述。
* 新增文档：新增 [Rodin Gen-2](/zh/api-specification/rodin-gen2) API 文档。

## 2025 年 8 月 [#2025-年-8-月]

* 新增文档：新增 [Rodin Godot Add-on](/zh/addons/godot-addon) 与 [Rodin Unity Add-on](/zh/addons/unity-addon) 文档。

## 2025 年 7 月 [#2025-年-7-月]

* 新增参数：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 新增 `quality_override` 参数。
* 新增参数：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 的 `material` 参数新增 `All` 取值。当前支持值为 `PBR`、`Shaded` 与 `All`（同时交付 PBR 与 Shaded）。

## 2025 年 5 月 [#2025-年-5-月]

* 移除参数：从 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 中移除了 `use_hyper` 参数。
* 更新参数：更新了 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 中 `tier` 参数的描述。tier 现支持四个取值：`Sketch`、`Regular`、`Detail` 与 `Smooth`。

## 2025 年 2 月 [#2025-年-2-月]

* 新增参数：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 新增 `mesh_smooth` 参数。

## 2025 年 1 月 [#2025-年-1-月]

* 新增文档：新增 [生成纹理](/zh/api-specification/generate-texture) API 文档。该端点为已有模型生成纹理。

## 2024 年 12 月 [#2024-年-12-月]

* 新增参数：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 新增 `mesh_mode`（控制面类型：`Raw` 为三角面，`Quad` 为四边面，默认 `Quad`）与 `mesh_simplify`（控制是否对模型进行简化；仅当 `mesh_mode` 为 `Raw` 时生效）参数。

## 2024 年 11 月 [#2024-年-11-月]

* 新增文档：新增 [查询余额](/zh/api-specification/check-balance) API 文档。该端点返回当前认证用户的 credit 余额。

## 2024 年 9 月 [#2024-年-9-月]

* 新增参数：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 新增 `condition_mode` 参数。控制生成模式，取值为 `fuse` 或 `concat`。
* 更新参数：将 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 中 `condition_mode` 的默认值从 `fuse` 改为 `concat`。

## 2024 年 8 月 [#2024-年-8-月]

* 新增功能：为 [Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5) API 新增文生 3D 模式。`images` 参数由必填改为可选（仅图生 3D 必填，文生 3D 为 NULL）。新增了最简文生 3D cURL 示例。

## 2024 年 7 月 [#2024-年-7-月]

* 新增文档：发布 Rodin API 文档。
# Rodin Agentic (/zh/api-specification/rodin-agentic)



<Callout type="warn" title="实验性功能">
  该功能目前为beta测试版本。 Rodin Agentic 使用 AI
  选择最合适的生成模式，因此结果可能会携带一些不确定性。
</Callout>



## 输入 [#输入]

提交一到五张参考图片 `images`，每个图片最大 25 MiB。 `prompt` 是可选的，当未提供时，服务会根据图片推导提示词。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin_agentic' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'images=@./input.png' \
  --form 'tier=standard' \
  --form 'export_type=glb'

```

## Tier & 定价 [#tier--定价]

| Tier       | Description                              | Elapsed Time | Charge        |
| ---------- | ---------------------------------------- | ------------ | ------------- |
| `basic`    | Basic tier: 较低的思考强度和较快的生成速度。             | 3 minutes    | `0.5 credits` |
| `standard` | Standard tier: 平衡的思考强度和生成速度。适用于大多数一般用途。  | 5 minutes    | `1.0 credits` |
| `pro`      | Pro tier: 较强的思考强度和较慢的生成速度。适用于复杂任务和更好的结果。 | 10 minutes   | `2.0 credits` |

## 响应与生命周期 [#响应与生命周期]

```json
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "producer": "high-poly",
  "job": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  }
}

```

用 `job.subscription_key` 检查状态，用 `uuid` 下载结果。
# Rodin Gen-2.5 (/zh/api-specification/rodin-gen2-5)





## 输入方式 [#输入方式]

### Image-to-3D [#image-to-3d]

提交一到五个 `images`。第一张图片用于材质生成。`prompt` 可选；省略时，服务会从图片推导提示信息。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'images=@./input.png' \
  --form 'tier=Gen-2.5-Medium' \
  --form 'mesh_mode=Raw' \
  --form 'quality=medium'

```

### Text-to-3D [#text-to-3d]

提交 `prompt`，并省略 `images`。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'prompt=A small wooden treasure chest with brass trim' \
  --form 'tier=Gen-2.5-Medium' \
  --form 'mesh_mode=Raw' \
  --form 'quality=medium'

```

## Tier [#tier]

<Callout type="info" title="tier 为必传参数">
  请始终显式传入一个 Gen-2.5 `tier`。如果省略 `tier`，接口会回退到 `Regular` 并生成 Gen-1/1.5 资产。
</Callout>

`tier` 用于选择生成系列以及模型的细节表现能力。它与下面的网格和纹理参数相互独立：任一 tier 都可以与 schema 允许的任意 `mesh_mode`、`quality` 或 `texture_mode` 组合使用。

| Tier                   | 适用场景                                           |
| ---------------------- | ---------------------------------------------- |
| `Gen-2.5-Extreme-Low`  | 快速生成简单资产。                                      |
| `Gen-2.5-Low`          | 结构清晰的资产和小型硬表面道具。                               |
| `Gen-2.5-Medium`       | 平衡结构与细节。                                       |
| `Gen-2.5-High`         | 更丰富的结构和更平滑的表面。                                 |
| `Gen-2.5-Extreme-High` | 适合需要还原高频细节的资产。<br />该 tier 还会返回一个额外的最多千万面数的网格。 |

## 几何生成模式 [#几何生成模式]

<span id="creative-mode" />

`geometry_instruct_mode` 用于选择输入如何影响几何生成。`creative` 允许更灵活地理解输入，适用于 `Gen-2.5-Medium` 及更高 tier。`faithful` 更注重还原参考图片和提示词，但效果因任务而异。

<Callout type="warn" title="实验性选项：faithful">
  `faithful` 未来可能停止支持，不建议用于生产环境。常规生成建议省略 `geometry_instruct_mode`，使用默认值。
</Callout>

## Fast mode [#fast-mode]

当满足以下条件时，会触发 **Fast mode**。

* `tier` 不是 `Gen-2.5-Extreme-High`.
* `geometry_file_format` 为 `glb`.
* `mesh_mode` 为 `Raw`.
* `quality_override` \<= 20000.

## Texture mode [#texture-mode]

`texture_mode` 用于选择纹理生成的精细程度。`texture_mode` 的默认值取决于所选的 `tier`。

| Tier                   | 默认 `texture_mode` |
| ---------------------- | ----------------- |
| `Gen-2.5-Extreme-Low`  | `extreme-low`     |
| `Gen-2.5-Low`          | `low`             |
| `Gen-2.5-Medium`       | `medium`          |
| `Gen-2.5-High`         | `high`            |
| `Gen-2.5-Extreme-High` | `high`            |

## 贴图分辨率 [#贴图分辨率]

纹理分辨率由 `texture_mode`、`uhd_texture` 和 `addons`（`HighPack`）共同决定。

`HighPack` 会按下表提高 pack 纹理分辨率。对于 Gen-2.5，它不会改变几何体，也不会额外生成高模。

<table>
  <thead>
    <tr>
      <th>
        texture_mode
      </th>

      <th>
        addons
      </th>

      <th>
        uhd_texture
      </th>

      <th>
        分辨率
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td rowSpan="4">
        extreme-low, low, medium, high
      </td>

      <td rowSpan="2">
        \[]
      </td>

      <td>
        false
      </td>

      <td>
        2K
      </td>
    </tr>

    <tr>
      <td>
        true
      </td>

      <td>
        4K
      </td>
    </tr>

    <tr>
      <td rowSpan="2">
        HighPack
      </td>

      <td>
        false
      </td>

      <td>
        4K
      </td>
    </tr>

    <tr>
      <td>
        true
      </td>

      <td>
        8K
      </td>
    </tr>

    <tr>
      <td rowSpan="4">
        extreme-high
      </td>

      <td rowSpan="2">
        \[]
      </td>

      <td>
        false
      </td>

      <td>
        6K
      </td>
    </tr>

    <tr>
      <td>
        true
      </td>

      <td>
        6K
      </td>
    </tr>

    <tr>
      <td rowSpan="2">
        HighPack
      </td>

      <td>
        false
      </td>

      <td>
        12K
      </td>
    </tr>

    <tr>
      <td>
        true
      </td>

      <td>
        12K
      </td>
    </tr>
  </tbody>
</table>

## 计费 [#计费]

| 项目                          | 扣费             |
| --------------------------- | -------------- |
| Gen-2.5 基础生成                | `0.5 credits`  |
| `tier=Gen-2.5-Extreme-High` | `+0.5 credits` |
| `texture_mode=extreme-high` | `+2.0 credits` |

各项费用累加计算。基础生成仅需 `0.5 credits`；除上表列出的参数外，其他参数均不会产生额外费用。

## 响应与生命周期 [#响应与生命周期]

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

使用 `jobs.subscription_key` [查询状态](/zh/api-specification/check-status)，使用顶层 `uuid` [下载结果](/zh/api-specification/download-results)。HTTP 201 仅表示接口已处理请求；只有在 `error` 缺失或为空且顶层 `uuid` 非空时，任务才算已受理。400 表示字段或文件无效，401 表示鉴权无效，429 表示触发限流。
# Rodin Gen-2 (/zh/api-specification/rodin-gen2)





## 输入 [#输入]

设置 `tier=Gen-2`。Image-to-3D 提交一到五个 `images`，并可选提交 `prompt`；Text-to-3D 提交 `prompt`，并省略 `images`。

<Callout type="info" title="tier 为必传参数">
  请始终显式传入 `tier=Gen-2`。如果省略 `tier`，endpoint 会回退到 `Regular` 并生成 Gen-1/1.5 asset。
</Callout>

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'images=@./input.png' \
  --form 'tier=Gen-2' \
  --form 'mesh_mode=Raw' \
  --form 'quality=medium'

```

`HighPack` 会把 pack 纹理从 2K 升级到 4K。对于 Gen-2，它不会改变几何体，也不会额外生成高模。

## 计费 [#计费]

| 项目         | 扣费            |
| ---------- | ------------- |
| Gen-2 基础生成 | `0.5 credits` |

各项费用累加计算。基础生成仅需 `0.5 credits`；除上表列出的参数外，其他参数均不会产生额外费用。

## 响应与生命周期 [#响应与生命周期]

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

使用 `jobs.subscription_key` [查询状态](/zh/api-specification/check-status)，使用顶层 `uuid` [下载结果](/zh/api-specification/download-results)。HTTP 201 仅表示 endpoint 已处理请求；只有在 `error` 缺失或为空且顶层 `uuid` 非空时，任务才算已受理。400 表示字段或文件无效，401 表示鉴权无效，429 表示触发限流。
# Rodin Gen-1/1.5 (/zh/api-specification/rodin-gen1-1-5)





## 输入 [#输入]

从 `Sketch`、`Regular`、`Detail` 或 `Smooth` 中选择一个 tier。Image-to-3D 提交一到五个 `images`；Text-to-3D 提交 `prompt`，并省略 `images`。

```bash
curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin' \
  --header "Authorization: Bearer ${RODIN_API_KEY}" \
  --form 'images=@./input.png' \
  --form 'tier=Regular' \
  --form 'mesh_mode=Quad' \
  --form 'quality=medium'

```

## 多图行为 [#多图行为]

* `condition_mode=concat` 把上传图片视为同一物体的多个视角。

* `condition_mode=fuse` 融合可能包含不同物体的多张图片中的特征。

* `mesh_mode` 可取 `Quad` 或 `Raw`，默认为 `Quad`。

* `quality` 用于选择预设目标面数，默认为 `medium`：
  * `Quad`：`high` 50000、`medium` 18000、`low` 8000、`extra-low` 4000。
  * `Raw`：`high` 50000、`medium` 18000、`low` 8000、`extra-low` 4000。

* `quality_override` 用于设置 500 到 200000 之间的自定义目标面数，提交后优先于 `quality`。

有两个选项仅适用于该系列：`mesh_simplify` 用于简化 `Raw` 网格，默认开启；`mesh_smooth` 用于平滑 `Quad` 网格，默认关闭。Add-on 的可用性取决于所选 tier。

`HighPack` 始终把 pack 纹理从 2K 升级到 4K。对于 `Quad` 模式的 `Sketch` 和 `Regular`，显式设置不超过 100000 的 `quality_override` 时，还会请求面数约为该值 16 倍的高模。对于 `Detail` 和 `Smooth`，HighPack 只改变纹理分辨率。

## 计费 [#计费]

| 项目             | 扣费            |
| -------------- | ------------- |
| Gen-1/1.5 基础生成 | `0.5 credits` |

各项费用累加计算。基础生成仅需 `0.5 credits`；除上表列出的参数外，其他参数均不会产生额外费用。

## 响应与生命周期 [#响应与生命周期]

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

使用 `jobs.subscription_key` [查询状态](/zh/api-specification/check-status)，使用顶层 `uuid` [下载结果](/zh/api-specification/download-results)。HTTP 201 仅表示 endpoint 已处理请求；只有在 `error` 缺失或为空且顶层 `uuid` 非空时，任务才算已受理。400 表示字段或文件无效，401 表示鉴权无效，429 表示触发限流。
# Bang (/zh/api-specification/bang)





Bang 只接受以下两种输入方式之一。同时提交 `asset_id` 和 `model`，或两者都不提交，都会被拒绝。

## Rodin asset 输入 [#rodin-asset-输入]

把已完成的 Rodin 生成响应中的顶层 `uuid` 作为 `asset_id`。

* 必填：`asset_id`。
* 可选：`geometry_file_format`、`strength`、`material`、`resolution`、`seed`、`escore` 和 `reference_scale`。
* 互斥：必须省略 `model`、`image` 和 `prompt`。

启用材质生成时，`escore` 和 `reference_scale` 对两种输入模式都生效。与 `asset_id` 一起传入的值会覆盖该 asset 中保存的对应设置；省略时 endpoint 使用请求默认值。

<Tabs items="['cURL', 'Python']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/bang' \
      --header "Authorization: Bearer ${RODIN_API_KEY}" \
      --form 'asset_id=123e4567-e89b-12d3-a456-426614174000' \
      --form 'strength=5' \
      --form 'geometry_file_format=glb'

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os

    import requests

    response = requests.post(
        "https://api.hyper3d.com/api/v2/bang",
        headers={"Authorization": f"Bearer {os.environ['RODIN_API_KEY']}"},
        data={
            "asset_id": "123e4567-e89b-12d3-a456-426614174000",
            "strength": 5,
            "geometry_file_format": "glb",
        },
        timeout=60,
    )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>
</Tabs>

## 自定义模型输入 [#自定义模型输入]

上传一个模型。除非 `material` 为 `None`，否则参考 `image` 为**必填**，因为材质生成需要采样来源；缺少时会返回 `INVALID_REQUEST`，并在 `message` 中说明原因。

* 必填：`model`；除非 `material=None`，否则还需要 `image`。
* 可选：`geometry_file_format`、`prompt`、`strength`、`material`、`resolution`、`reference_scale`、`escore`、`seed`。
* 互斥：必须省略 `asset_id`。
* 支持的模型格式：`obj`、`glb`、`stl`、`fbx`、`usd`、`usda`、`usdz` 和 `usdc`。
* `strength` 取值范围为 1 到 12，默认为 5。值越大，模型被拆分出的部件越多。

<Tabs items="['cURL', 'Python']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/bang' \
      --header "Authorization: Bearer ${RODIN_API_KEY}" \
      --form 'model=@./model.glb' \
      --form 'image=@./reference.png' \
      --form 'prompt=Separate the main structural parts' \
      --form 'strength=5' \
      --form 'geometry_file_format=glb'

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os
    from pathlib import Path

    import requests

    with Path("model.glb").open("rb") as model_file, Path("reference.png").open("rb") as image_file:
        response = requests.post(
            "https://api.hyper3d.com/api/v2/bang",
            headers={"Authorization": f"Bearer {os.environ['RODIN_API_KEY']}"},
            files={
                "model": ("model.glb", model_file, "model/gltf-binary"),
                "image": ("reference.png", image_file, "image/png"),
            },
            data={
                "prompt": "Separate the main structural parts",
                "strength": 5,
                "geometry_file_format": "glb",
            },
            timeout=60,
        )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>
</Tabs>

## 计费 [#计费]

每个 Bang 请求均扣除 `0.5 credits`，不受 Rodin asset、自定义上传模型或其他输入选项影响。

## 响应与错误 [#响应与错误]

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

Bang 使用与其他生成 endpoint 相同的应用错误码。HTTP 201 仅表示 endpoint 已处理请求；只有在 `error` 缺失或为空且顶层 `uuid` 非空时，任务才算已受理。HTTP 400 表示字段无效、文件不受支持或输入方式冲突；401 表示鉴权无效；429 表示触发限流。状态查询和下载遵循与其他生成接口相同的标识规则。
# 生成纹理 (/zh/api-specification/generate-texture)





## 输入 [#输入]

通过 multipart 上传恰好一张参考图片和恰好一个 3D 模型，两者都是必填项。

图片支持 JPEG、PNG、WebP、TIFF、GIF、AVIF、HEIC、HEIF、BMP 和 JPEG 2000；模型支持 OBJ、STL、glTF/GLB、FBX 和 USDZ。

`material` 可取 `PBR`、`Shaded` 或 `All`，默认为 `PBR`；`All` 会同时交付 PBR 和 Shaded 输出。`resolution` 可取 `Basic`（2K）或 `High`（4K），默认为 `Basic`。

## 示例 [#示例]

<Tabs items="['cURL', 'Python']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/rodin_texture_only' \
      --header "Authorization: Bearer ${RODIN_API_KEY}" \
      --form 'image=@./reference.png' \
      --form 'model=@./model.glb' \
      --form 'material=PBR' \
      --form 'resolution=Basic'

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os
    from pathlib import Path

    import requests

    with Path("reference.png").open("rb") as image_file, Path("model.glb").open("rb") as model_file:
        response = requests.post(
            "https://api.hyper3d.com/api/v2/rodin_texture_only",
            headers={"Authorization": f"Bearer {os.environ['RODIN_API_KEY']}"},
            files={
                "image": ("reference.png", image_file, "image/png"),
                "model": ("model.glb", model_file, "model/gltf-binary"),
            },
            data={"material": "PBR", "resolution": "Basic"},
            timeout=60,
        )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>
</Tabs>

## 贴图分辨率 [#贴图分辨率]

贴图分辨率由 `texture_mode` 和 `resolution` 决定。

<table>
  <thead>
    <tr>
      <th>
        texture_mode
      </th>

      <th>
        resolution
      </th>

      <th>
        Output resolution
      </th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td rowSpan="2">
        legacy, extreme-low, low, medium, high
      </td>

      <td>
        Basic
      </td>

      <td>
        2K
      </td>
    </tr>

    <tr>
      <td>
        High
      </td>

      <td>
        4K
      </td>
    </tr>

    <tr>
      <td rowSpan="2">
        extreme-high
      </td>

      <td>
        Basic
      </td>

      <td>
        6K
      </td>
    </tr>

    <tr>
      <td>
        High
      </td>

      <td>
        12K
      </td>
    </tr>
  </tbody>
</table>

## 计费 [#计费]

| 项目                          | 收费            |
| --------------------------- | ------------- |
| 基础贴图生成                      | `0.5 credits` |
| `texture_mode=extreme-high` | `2.0 credits` |

## 响应与错误 [#响应与错误]

提交成功后的标识规则与 Rodin 生成一致：用 `jobs.subscription_key` 查询状态，用顶层 `uuid` 下载结果。

```json
{
  "message": "Submitted.",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "jobs": {
    "uuids": ["223e4567-e89b-12d3-a456-426614174000"],
    "subscription_key": "subscription-key-from-generation-response"
  },
  "consumed": 0.5
}

```

HTTP 201 仅表示 endpoint 已处理请求；只有在 `error` 缺失或为空且顶层 `uuid` 非空时，任务才算已受理。HTTP 400 表示字段或文件无效，401 表示鉴权无效，429 表示触发限流。
# 查询状态 (/zh/api-specification/check-status)





## 标识选择 [#标识选择]

此接口需要生成响应中的 `jobs.subscription_key`。不要传入顶层 `uuid`，也不要传入 `jobs.uuids` 中的值。

## Job 状态 [#job-状态]

`jobs` 中的每个条目都会返回以下四种状态之一：

| 状态           | 含义                  |
| ------------ | ------------------- |
| `Waiting`    | 排队中，或正在等待依赖的 job。   |
| `Generating` | 有 worker 正在执行该 job。 |
| `Done`       | 该 job 的结果已可下载。      |
| `Failed`     | 该 job 已停止，不会产出结果。   |

当 job 处于 `Waiting` 时，响应中还可能包含 `queue_length`，表示排在它前面的 job 的大致数量。job 离开队列后该字段会被省略。

## 示例 [#示例]

<Tabs items="['cURL', 'Python', 'Go']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/status' \
      --header "Authorization: Bearer ${RODIN_API_KEY}" \
      --header 'Content-Type: application/json' \
      --data '{"subscription_key":"subscription-key-from-generation-response"}'

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os

    import requests

    api_key = os.environ["RODIN_API_KEY"]
    response = requests.post(
        "https://api.hyper3d.com/api/v2/status",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"subscription_key": "subscription-key-from-generation-response"},
        timeout=30,
    )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>

  <Tab value="Go">
    ```go
    package main

    import (
    	"bytes"
    	"encoding/json"
    	"fmt"
    	"io"
    	"net/http"
    	"os"
    	"time"
    )

    func main() {
    	body, err := json.Marshal(map[string]string{
    		"subscription_key": "subscription-key-from-generation-response",
    	})
    	if err != nil {
    		panic(err)
    	}
    	req, err := http.NewRequest(http.MethodPost, "https://api.hyper3d.com/api/v2/status", bytes.NewReader(body))
    	if err != nil {
    		panic(err)
    	}
    	req.Header.Set("Authorization", "Bearer "+os.Getenv("RODIN_API_KEY"))
    	req.Header.Set("Content-Type", "application/json")
    	client := &http.Client{Timeout: 30 * time.Second}
    	response, err := client.Do(req)
    	if err != nil {
    		panic(err)
    	}
    	defer response.Body.Close()
    	responseBody, err := io.ReadAll(response.Body)
    	if err != nil {
    		panic(err)
    	}
    	if response.StatusCode >= 400 {
    		panic(fmt.Sprintf("HTTP %d: %s", response.StatusCode, responseBody))
    	}
    	fmt.Println(string(responseBody))
    }

    ```
  </Tab>
</Tabs>

## 响应 [#响应]

```json
{
  "jobs": [
    {
      "uuid": "223e4567-e89b-12d3-a456-426614174000",
      "status": "Done"
    }
  ]
}

```

## 轮询与错误 [#轮询与错误]

查询成功返回 HTTP 201。HTTP 400 表示请求体无效，401 表示鉴权缺失或无效，429 表示触发限流。首次查询前等待 5 秒，逐步退避到最长 30 秒，遵循 `Retry-After`；任一 job 为 `Failed` 时立即停止，并设置客户端总期限。
# 下载结果 (/zh/api-specification/download-results)





## 标识选择 [#标识选择]

把生成响应顶层的 `uuid` 作为 `task_uuid` 提交。它与[查询状态](/zh/api-specification/check-status)所用的 `jobs.subscription_key` 不同。

## 示例 [#示例]

<Tabs items="['cURL', 'Python']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body --request POST 'https://api.hyper3d.com/api/v2/download' \
      --header "Authorization: Bearer ${RODIN_API_KEY}" \
      --header 'Content-Type: application/json' \
      --data '{"task_uuid":"123e4567-e89b-12d3-a456-426614174000"}'

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os

    import requests

    api_key = os.environ["RODIN_API_KEY"]
    response = requests.post(
        "https://api.hyper3d.com/api/v2/download",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"task_uuid": "123e4567-e89b-12d3-a456-426614174000"},
        timeout=30,
    )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>
</Tabs>

## 响应 [#响应]

```json
{
  "list": [
    {
      "name": "model.glb",
      "url": "https://example.invalid/download/model.glb"
    }
  ]
}

```

## 可用性与错误 [#可用性与错误]

仅在所有 job 都为 `Done` 后调用此接口；该 endpoint 不承诺拒绝尚未完成的任务。HTTP 201 返回当前可用文件，400 表示请求无效，401 表示鉴权无效，429 表示触发限流。下载链接可能过期，应及时下载文件，不要长期保存链接。
# 查询余额 (/zh/api-specification/check-balance)





## 用量记录 [#用量记录]

未传入 `usage_page` 时，响应中不包含 `usage`。

## 示例 [#示例]

<Tabs items="['cURL', 'Python']">
  <Tab value="cURL">
    ```bash
    curl --fail-with-body 'https://api.hyper3d.com/api/v2/check_balance?usage_page=1' \
      --header "Authorization: Bearer ${RODIN_API_KEY}"

    ```
  </Tab>

  <Tab value="Python">
    ```python
    import os

    import requests

    response = requests.get(
        "https://api.hyper3d.com/api/v2/check_balance",
        headers={"Authorization": f"Bearer {os.environ['RODIN_API_KEY']}"},
        params={"usage_page": 1},
        timeout=30,
    )
    response.raise_for_status()
    print(response.json())

    ```
  </Tab>
</Tabs>

## 响应 [#响应]

```json
{
  "balance": 10,
  "usage": [
    {
      "time": "2026-08-05T08:30:00.000Z",
      "item": "api_generation_rodin",
      "amount": 5,
      "task_uuid": "123e4567-e89b-12d3-a456-426614174000"
    }
  ]
}

```
# 错误码 (/zh/api-specification/errors)



## 错误的返回方式 [#错误的返回方式]

Rodin API 会在两个不同的位置返回失败信息，正确的客户端需要同时检查这两处。

**传输层失败**通过 HTTP 状态码返回：`400` 表示请求格式错误，`401` 表示缺少或无效的鉴权信息，`429` 表示触发限流。

**应用层失败通过响应体返回，而不是 HTTP 状态码。** 被拒绝的提交同样返回 HTTP `201`，具体原因在 `error` 中，可读的详细信息在 `message` 中。只检查 HTTP 状态码的客户端会把被拒绝的请求当成提交成功，进而去轮询一个根本不存在的任务。

```json
{
  "error": "API_INSUFFICIENT_FUNDS",
  "message": "The fund in your wallet is insufficient to perform this operation."
}
```

## 提交类错误 [#提交类错误]

由 [Rodin Gen-2.5](/zh/api-specification/rodin-gen2-5)、[Rodin Gen-2](/zh/api-specification/rodin-gen2)、[Rodin Gen-1/1.5](/zh/api-specification/rodin-gen1-1-5)、[生成纹理](/zh/api-specification/generate-texture)和 [Bang](/zh/api-specification/bang) 返回。

| 错误码                             | 含义                              |
| ------------------------------- | ------------------------------- |
| `INVALID_REQUEST`               | 请求格式错误、缺少参数或取值无效，详见 `message`。  |
| `API_NO_ACTIVE_SUBSCRIPTION`    | 账户没有有效订阅。                       |
| `API_SUBSCRIPTION_PLAN_TOO_LOW` | 当前订阅套餐不支持 API 访问。               |
| `API_PARALLELISM_LIMIT_REACHED` | 账户正在运行的任务过多，请等待任务完成后重试。         |
| `API_INSUFFICIENT_FUNDS`        | 账户余额不足以完成本次请求。                  |
| `API_OBJECT_NOT_FOUND_ON_IMAGE` | 未在输入图片中检测到物体，或图片格式不受支持。         |
| `IMAGE_CONTENT_VIOLATION`       | 输入图片在您所在地区不被允许，请更换图片。           |
| `IMAGE_LABEL_LENGTH_TOO_LONG`   | 提交的 `image_label` 数量超过了上传的图片数量。 |
| `NO_SUCH_TASK`                  | 引用的任务不存在或已过期。                   |
| `ASSET_NOT_AVAILABLE`           | 引用的资产当前状态不支持该操作。                |
| `PERMISSION_DENIED`             | 账户无权执行该操作。                      |
| `API_UNKNOWN`                   | 服务端未预期的错误，详见 `message`。         |

Text-to-3D 的 prompt 会先被渲染成图片再进行生成，因此纯文本请求同样可能返回 `IMAGE_CONTENT_VIOLATION`。

## 状态与下载类错误 [#状态与下载类错误]

[查询状态](/zh/api-specification/check-status)可能返回：

| 错误码            | 含义                         |
| -------------- | -------------------------- |
| `NO_SUCH_TASK` | subscription key 未匹配到可用任务。 |

[下载结果](/zh/api-specification/download-results)可能返回：

| 错误码               | 含义                      |
| ----------------- | ----------------------- |
| `NO_SUCH_TASK`    | task UUID 未匹配到该用户拥有的任务。 |
| `INVALID_REQUEST` | 该任务没有此用户可下载的文件。         |

一个常见错误是传错标识：`/status` 需要 `jobs.subscription_key`，`/download` 需要顶层 `uuid`。两者互换会返回 `NO_SUCH_TASK`。

## 限流与重试 [#限流与重试]

限流按接口和账户分别计算，轮询 `/status` 的额度远高于提交生成任务的额度。官方定价页会公布 Business API 的每分钟请求数，但该数值随订阅 tier 变化且可能调整，请不要把它写死在代码中。

HTTP `429` 会带上 `Retry-After` 响应头，给出需要等待的秒数。请遵循该响应头，不要立即重试；在运行时应以它为准，而不是任何已公布的限额数字。

对 `429` 和 `5xx` 响应应使用退避策略重试。但**不要**重试响应体中的 `error`：这类拒绝是确定性的，重新提交只会得到相同结果，同时额外占用一次请求配额。
