"""
Test Suite: Rodin Adapter Client
Validates Hyper3D Rodin API authentication and credit status.
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.rodin_adapter import RodinClient


def test_rodin_client_balance():
    client = RodinClient()
    bal_info = client.check_balance()
    assert "balance" in bal_info, "Response missing 'balance'"
    assert bal_info["balance"] >= 0, f"Unexpected balance value: {bal_info['balance']}"
    print(f"[PASS] Rodin API connection verified: Balance = {bal_info['balance']} credits")


def main():
    print("=" * 60)
    print("Running Rodin Adapter API Tests...")
    print("=" * 60)
    test_rodin_client_balance()
    print("\n[SUCCESS] Rodin adapter tests passed!")


if __name__ == "__main__":
    main()
