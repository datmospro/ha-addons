#!/usr/bin/env python3
# Quick script to fix the synopsis CSS
import os

css_file = r"c:\Users\Datmos\Documents\ha-addons\roverr\app\static\styles\movies.css"

# Read the file
with open(css_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the .synopsis p section
old_section = """.synopsis p {
    color: var(--text-secondary);
    line-height: 1.6;
}"""

new_section = """.synopsis p {
    color: var(--text-secondary);
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
}"""

content = content.replace(old_section, new_section)

# Write back
with open(css_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Synopsis CSS updated successfully!")
