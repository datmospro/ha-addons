#!/usr/bin/env python3
# Fix grid layout to prevent overflow
import os
import re

css_file = r"c:\Users\Datmos\Documents\ha-addons\roverr\app\static\styles\movies.css"

# Read the file
with open(css_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Change grid-template-columns to use minmax for better control
content = re.sub(
    r'grid-template-columns:\s*300px\s+1fr;',
    'grid-template-columns: 300px minmax(0, 1fr);',
    content
)

# Fix 2: Ensure all direct children have proper box-sizing
# Find .synopsis section and add wrapper box-sizing
synopsis_match = re.search(r'\.synopsis h3 \{', content)
if synopsis_match:
    insert_pos = synopsis_match.start()
    new_styles = """.synopsis {
    min-width: 0;
    box-sizing: border-box;
}

"""
    content = content[:insert_pos] + new_styles + content[insert_pos:]

# Fix 3: Ensure paths-box doesn't overflow
content = re.sub(
    r'(\.paths-box \{[^}]*?)(\})',
    r'\1    min-width: 0;\n    box-sizing: border-box;\n\2',
    content,
    flags=re.DOTALL
)

# Write back
with open(css_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Grid layout fixed!")
print("   - Changed grid to use minmax(0, 1fr)")
print("   - Added .synopsis wrapper with box-sizing")
print("   - Added box-sizing to .paths-box")
