"""Makes the JSPARK Forge demo GIF: an animation that replays the kill-and-resume flow.

It is an illustration, not a screen recording. The JSPARK Forge line is the text the plugin prints at a session
start (scripts/lib/handoff.js, summary()). Brand: Inter only, #FF7A00 as the one accent, dark background, squared corners.

Usage: python make_demo_gif.py <Inter variable .ttf> <output .gif>
"""
import sys
from PIL import Image, ImageDraw, ImageFont

FONT_FILE, OUT = sys.argv[1], sys.argv[2]
W, H = 960, 540
DARK, PANEL, LINE = (6, 10, 24), (17, 24, 39), (31, 41, 55)
WHITE, SOFT, ORANGE, GREEN = (255, 255, 255), (148, 163, 184), (255, 122, 0), (16, 185, 129)


def font(size, bold=False):
    f = ImageFont.truetype(FONT_FILE, size)
    f.set_variation_by_axes([min(32, max(14, size)), 700 if bold else 400])
    return f


F_TEXT, F_BOLD, F_TITLE, F_CAP = font(22), font(22, True), font(15, True), font(26, True)
F_SUB, F_BIG, F_END, F_MID = font(18), font(46, True), font(19), font(32, True)
F_SUB_BOLD = font(22, True)
PX0, PY0, PX1, PY1 = 40, 36, 920, 418  # the terminal panel
TX, TY, LH = PX0 + 28, PY0 + 80, 36  # first text line, line height
MAXW = PX1 - 26 - TX


def wrap(segments):
    """segments: [(text, font, colour)] -> list of lines, each a list of (text, font, colour), wrapped by words."""
    lines, cur, width = [], [], 0.0
    for text, f, col in segments:
        for i, word in enumerate(text.split(' ')):
            if word == '':
                continue
            piece = word if (i == 0 and not cur) else ' ' + word
            if i == 0 and cur and not text.startswith(' '):
                piece = word
            w = f.getlength(piece)
            if cur and width + w > MAXW:
                lines.append(cur)
                cur, width, piece = [], 0.0, word
                w = f.getlength(piece)
            cur.append((piece, f, col))
            width += w
    if cur:
        lines.append(cur)
    return lines


def draw_frame(title, lines, caption='', sub='', closed=False, end=False, opening=False):
    im = Image.new('RGB', (W, H), DARK)
    d = ImageDraw.Draw(im)
    if opening:  # who it is for, before anything else (owner, 2026-11-22)
        d.text((W / 2, 150), 'FOR NON-TECHNICAL BUILDERS', font=F_TITLE, fill=ORANGE, anchor='mm')
        d.text((W / 2, 212), 'Not a coder?', font=F_BIG, fill=WHITE, anchor='mm')
        d.text((W / 2, 272), 'Build real products with Claude Code.', font=F_MID, fill=WHITE, anchor='mm')
        d.text((W / 2, 352), 'Until the window closes, and you have to explain everything again.', font=F_END, fill=SOFT, anchor='mm')
        return im
    if end:
        d.text((W / 2, 176), 'Claude Code forgets.', font=F_BIG, fill=WHITE, anchor='mm')
        d.text((W / 2, 236), 'JSPARK Forge doesn’t.', font=F_BIG, fill=ORANGE, anchor='mm')
        d.text((W / 2, 312), 'Keep building. Never explain your project twice.', font=F_SUB_BOLD, fill=WHITE, anchor='mm')
        d.text((W / 2, 366), 'Free and open source  ·  github.com/harishgoswami23/jspark-forge', font=F_END, fill=SOFT, anchor='mm')
        return im
    if not closed:
        d.rectangle([PX0, PY0, PX1, PY1], fill=PANEL, outline=LINE, width=1)
        d.line([PX0, PY0 + 38, PX1, PY0 + 38], fill=LINE, width=1)
        d.rectangle([PX0, PY0, PX0 + 4, PY0 + 38], fill=ORANGE)  # the one accent: left, on the title bar
        d.text((PX0 + 22, PY0 + 19), title.upper(), font=F_TITLE, fill=SOFT, anchor='lm')
        y = TY
        for segs in lines:
            x = TX
            for text, f, col in segs:
                if text == CURSOR:  # a typing cursor, drawn (Inter has no block character)
                    d.rectangle([x + 3, y - 19, x + 13, y + 3], fill=WHITE)
                    continue
                d.text((x, y), text, font=f, fill=col, anchor='ls')
                x += f.getlength(text)
            y += LH
    else:
        d.rectangle([PX0, PY0, PX1, PY1], outline=LINE, width=1)
        d.text((W / 2, (PY0 + PY1) / 2), 'window closed', font=F_SUB, fill=LINE, anchor='mm')
    if caption:
        d.text((W / 2, 462), caption, font=F_CAP, fill=WHITE, anchor='mm')
    if sub:
        d.text((W / 2, 498), sub, font=F_SUB, fill=SOFT, anchor='mm')
    return im


CURSOR = '<cursor>'
frames = []  # (image, milliseconds)


def show(ms, **kw):
    frames.append((draw_frame(**kw), ms))


def typed(title, before, prefix, text, after_ms, caption='', sub='', step=2, ms=45):
    """Type `text` after a prompt `prefix`, on a new line below the lines in `before`."""
    for n in list(range(0, len(text), step)) + [len(text)]:
        lines = wrap([(prefix, F_BOLD, ORANGE), (text[:n], F_TEXT, WHITE)])
        if n < len(text):
            lines[-1] = lines[-1] + [(CURSOR, F_TEXT, WHITE)]
        show(ms, title=title, lines=before + lines, caption=caption, sub=sub)
    show(after_ms, title=title, lines=before + wrap([(prefix, F_BOLD, ORANGE), (text, F_TEXT, WHITE)]), caption=caption, sub=sub)
    return before + wrap([(prefix, F_BOLD, ORANGE), (text, F_TEXT, WHITE)])


def says(title, lines, new, ms, caption='', sub=''):
    lines = lines + wrap(new)
    show(ms, title=title, lines=lines, caption=caption, sub=sub)
    return lines


CC = 'Claude Code  ·  invoice-app'
bullet = lambda t: [('•  ', F_BOLD, ORANGE), (t, F_TEXT, SOFT)]
plain = lambda t: [(t, F_TEXT, WHITE)]

# 0. Who it is for
show(3400, title='', lines=[], opening=True)

# 1. Work starts
show(500, title=CC, lines=[])
L = typed(CC, [], '>  ', 'Add a monthly totals report. Start with the data function, then the page.', 500)
L = says(CC, L, [(' ', F_TEXT, WHITE)], 150)
L = says(CC, L, bullet('Writing src/reports/monthly-totals.js'), 800)
L = says(CC, L, bullet('Editing src/app.js'), 800)
L = says(CC, L, bullet('Running the tests …'), 1100)

# 2. The window closes mid-task
show(2800, title=CC, lines=[], closed=True, caption='The window closes mid-task.', sub='A crash, a logout, or a usage limit.')

# 3. A new session
show(500, title='Terminal  ·  invoice-app', lines=[])
L = typed('Terminal  ·  invoice-app', [], '$  ', 'claude', 600, step=1, ms=110)

# 4. JSPARK Forge shows where the work stood (the plugin's own words)
FORGE = [('JSPARK Forge:', F_BOLD, ORANGE),
         (' last time you were on “Add a monthly totals report”, step 2 of 3. Next: the report page.'
          ' Say ‘continue’ or tell me what to do instead.', F_TEXT, WHITE)]
CAP4 = 'New session. Nothing explained again.'
L = says(CC, [], FORGE, 4400, caption=CAP4)

# 5. One word
L = says(CC, L, [(' ', F_TEXT, WHITE)], 100, caption=CAP4)
L = typed(CC, L, '>  ', 'continue', 600, caption=CAP4, step=1, ms=120)

# 6. It carries on
CAP6 = 'It carries on from the same step.'
L = says(CC, L, [(' ', F_TEXT, WHITE)], 150, caption=CAP6)
L = says(CC, L, plain('We were adding the monthly totals report. Step 2 of 3.'), 1100, caption=CAP6)
L = says(CC, L, plain('Done: the data function. Half done: src/app.js, checked, intact.'), 1300, caption=CAP6)
L = says(CC, L, bullet('Editing src/pages/report.js'), 3200, caption=CAP6)

# 7. End card
show(3600, title='', lines=[], end=True)

# Join equal frames that follow each other, then save with one shared palette (small file, steady colours).
merged = []
for im, ms in frames:
    if merged and merged[-1][0].tobytes() == im.tobytes():
        merged[-1] = (merged[-1][0], merged[-1][1] + ms)
    else:
        merged.append((im, ms))
sheet = Image.new('RGB', (W, H * 3))
for i, k in enumerate([len(merged) // 4, len(merged) // 2, len(merged) - 1]):
    sheet.paste(merged[k][0], (0, H * i))
palette = sheet.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
out = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im, _ in merged]
out[0].save(OUT, save_all=True, append_images=out[1:], duration=[ms for _, ms in merged], loop=0, optimize=False, disposal=1)
print('frames', len(merged), 'seconds', round(sum(ms for _, ms in merged) / 1000, 1))
