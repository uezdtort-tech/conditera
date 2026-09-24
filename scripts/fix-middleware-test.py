"""Fix middleware.test.ts — добавить await перед всеми вызовами middleware(req)."""
import re

PATH = '/home/z/my-project/src/middleware.test.ts'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Заменяем `const res = middleware(req)` → `const res = await middleware(req)`
# Заменяем `const res = middleware(req, event)` → `const res = await middleware(req, event)`
new_content = re.sub(
    r'const res = (await\s+)?middleware\(',
    'const res = await middleware(',
    content
)

# Все тесты внутри `it('...', () => {...})` должны быть async: `it('...', async () => {...})`
# Находим describe/it блоки и делаем коллбэки async
new_content = re.sub(
    r"it\(('|\")(.*?)('|\"),\s*\(\)\s*=>\s*\{",
    r"it(\1\2\3, async () => {",
    new_content
)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(new_content)

# Проверка
diff_count = (content.count('() => {') - new_content.count('() => {'))
await_count = new_content.count('await middleware(')
print(f'Fixed: {await_count} await calls added/confirmed, {diff_count} callbacks made async')
