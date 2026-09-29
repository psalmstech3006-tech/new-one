"""Inline the Vite build (dist/) into one self-contained HTML file: free-world.html."""
import glob, re
html = open('dist/index.html').read()
css = ''.join(open(f).read() for f in glob.glob('dist/assets/*.css'))
(js_path,) = glob.glob('dist/assets/*.js')
js = open(js_path).read()
assert '</script' not in js.lower()
# embed generated assets referenced by path so the file works from disk (file://)
import base64, os
for root, _, files in os.walk('dist/assets'):
    for f in files:
        if not f.endswith('.glb'):
            continue
        rel = os.path.relpath(os.path.join(root, f), 'dist')  # e.g. assets/vehicles/x.glb
        uri = 'data:model/gltf-binary;base64,' + base64.b64encode(open(os.path.join(root, f), 'rb').read()).decode()
        stem = rel.rsplit('_lod', 1)[0] if '_lod' in rel else None
        js = js.replace(rel, uri)
        print('embedded', rel, len(uri) // 1024, 'KB')
html = re.sub(r'<script type="module" crossorigin src="[^"]*"></script>', lambda m: '', html)
html = re.sub(r'<link rel="stylesheet"[^>]*assets/[^>]*>', lambda m: '<style>' + css + '</style>', html)
html = html.replace('</body>', '<script type="module">\n' + js + '\n</script>\n</body>')
assert 'assets/index' not in html
open('free-world.html', 'w').write(html)
print(f'free-world.html: {len(html) // 1024} KB')
