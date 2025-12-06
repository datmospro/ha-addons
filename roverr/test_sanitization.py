#!/usr/bin/env python3
"""
Test script to verify path sanitization works correctly.
Run this to confirm the security fix prevents path traversal attacks.
"""

import sys
import os

# Add parent directory to path to import logic module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from logic import sanitize_path_component

# Test cases
test_cases = [
    # (input, expected_output, description)
    ("Vengadores: El despertar", "Vengadores: El despertar", "Legitimate title with colon"),
    ("Movie - Part 2", "Movie - Part 2", "Legitimate title with hyphen"),
    ("../../etc/passwd", "____etc_passwd", "Path traversal attack blocked"),
    ("Movie/Bad/Path", "Movie_Bad_Path", "Forward slashes removed"),
    ("Movie\\Windows\\Path", "Movie_Windows_Path", "Backslashes removed"),
    ("Normal Movie", "Normal Movie", "Normal title unchanged"),
    ("Star Wars: Episode IV", "Star Wars: Episode IV", "Colon preserved"),
    ("/root/evil", "_root_evil", "Absolute path blocked"),
    ("Movie\0Null", "MovieNull", "Null byte removed"),
    ("A" * 250, "A" * 200, "Long title truncated to 200 chars"),
]

print("🔒 Path Sanitization Security Test\n")
print("=" * 70)

passed = 0
failed = 0

for input_val, expected, description in test_cases:
    result = sanitize_path_component(input_val)
    
    # For truncation test, just check length
    if len(input_val) > 200:
        if len(result) <= 200:
            status = "✅ PASS"
            passed += 1
        else:
            status = "❌ FAIL"
            failed += 1
    else:
        if result == expected:
            status = "✅ PASS"
            passed += 1
        else:
            status = "❌ FAIL"
            failed += 1
    
    print(f"\n{status} - {description}")
    print(f"  Input:    '{input_val[:50]}{'...' if len(input_val) > 50 else ''}'")
    print(f"  Expected: '{expected[:50]}{'...' if len(expected) > 50 else ''}'")
    print(f"  Got:      '{result[:50]}{'...' if len(result) > 50 else ''}'")

print("\n" + "=" * 70)
print(f"\n📊 Results: {passed} passed, {failed} failed")

if failed == 0:
    print("✅ All security tests passed! Path traversal protection is working.")
    sys.exit(0)
else:
    print("❌ Some tests failed. Review sanitization logic.")
    sys.exit(1)
