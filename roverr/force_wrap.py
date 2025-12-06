#!/usr/bin/env python3
# Add !important rules to force text wrapping
import os

css_file = r"c:\Users\Datmos\Documents\ha-addons\roverr\app\static\styles\movies.css"

# Read the file
with open(css_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Add aggressive wrapping rules for .synopsis p
old_synopsis_p = """.synopsis p {
    color: var(--text-secondary);
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
}"""

new_synopsis_p = """.synopsis p {
    color: var(--text-secondary);
    line-height: 1.6;
    word-wrap: break-word !important;
    overflow-wrap: break-word !important;
    white-space: normal !important;
    max-width: 100% !important;
    width: 100%;
}"""

content = content.replace(old_synopsis_p, new_synopsis_p)

# Add aggressive wrapping for .path-item code
old_path_code = """.path-item code {
    display: block;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.5rem;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9rem;
    word-break: break-all;
}"""

new_path_code = """.path-item code {
    display: block;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.5rem;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.9rem;
    word-break: break-all !important;
    overflow-wrap: break-word !important;
    white-space: normal !important;
    max-width: 100% !important;
}"""

content = content.replace(old_path_code, new_path_code)

# Write back
with open(css_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Added !important rules to force text wrapping!")
print("   - Updated .synopsis p with !important")
print("   - Updated .path-item code with !important")
print("\n⚠️  IMPORTANT: Do a hard refresh in browser:")
print("   - Chrome/Edge: Ctrl + Shift + R or Ctrl + F5")
print("   - Firefox: Ctrl + Shift + R")
