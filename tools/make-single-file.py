"""Inline the Vite build (dist/) into one self-contained HTML file: free-world.html."""
import glob, re
html = open('dist/index.html').read()
css = ''.join(open(f).read() for f in glob.glob('dist/assets/*.css'))
(js_path,) = glob.glob('dist/assets/*.js')
js = open(js_path).read()
assert '</script' not in js.lower()
html = re.sub(r'<script type="module" crossorigin src="[^"]*"></script>', lambda m: '', html)
html = re.sub(r'<link rel="stylesheet"[^>]*assets/[^>]*>', lambda m: '<style>' + css + '</style>', html)
html = html.replace('</body>', '<script type="module">\n' + js + '\n</script>\n</body>')
assert 'assets/index' not in html
open('free-world.html', 'w').write(html)
print(f'free-world.html: {len(html) // 1024} KB')
