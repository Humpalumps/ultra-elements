# Cut the promo from a shot plan: python cut.py <shotplan.json> <clipsDir> <out.mp4>
# Each clip file is clip-NN-*.mp4, one frame per 1/60 s step (its timestamps are wall clock, so frames are counted,
# not timed): 0.5 s of steps, the cast, then `record` spell seconds filmed at `speed`. in/out are spell seconds from the cast.
# A frame or two lost as the encoder starts comes off the front, so the cast is found from the end. A clip's `transition` is how it leaves: cut, 'dissolve N' (overlaps N s) or 'dip N' (fades
# through black inside both clips' own time). The title holds over clip 1's first frame; the end card is text on black.
import json, sys, subprocess, pathlib, re, shutil

FF = shutil.which('ffmpeg') or sys.exit('ffmpeg is not on PATH (winget install Gyan.FFmpeg)')
PRE, FPS = 0.5, 60
plan_path, clips_dir, out = sys.argv[1:4]
plan = json.load(open(plan_path, encoding='utf-8'))
clips_dir = pathlib.Path(clips_dir)
work = clips_dir / 'cut'
work.mkdir(exist_ok=True)
ENC = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', str(FPS)]
FONT = 'C\\:/Windows/Fonts/'

def count(p):
    r = subprocess.run([str(pathlib.Path(FF).with_name(pathlib.Path(FF).name.replace('ffmpeg', 'ffprobe'))), '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(p)], capture_output=True, text=True)
    return int(r.stdout.strip())

def run(args):
    r = subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *args], capture_output=True, text=True)
    if r.returncode: sys.exit(r.stderr[-2000:])

def leave(t):   # ('cut' | 'dissolve' | 'dip', seconds)
    m = re.match(r'\s*([a-z]+)\D*([\d.]+)?', str(t or 'cut').lower())
    kind = 'dissolve' if m.group(1).startswith(('dissolve', 'cross')) else 'dip' if m.group(1).startswith(('dip', 'black', 'fade')) else 'cut'
    return kind, float(m.group(2) or (0.4 if kind != 'cut' else 0))

def text_filters(c, alpha='1'):   # the first line big, the rest under it
    lines = [l for l in c['text'].split('\n') if l.strip()]
    out = []
    for i, l in enumerate(lines):
        tf = work / f'{c["_name"]}_{i}.txt'
        tf.write_text(l, encoding='utf-8')
        big = i == 0
        size, font = (120, 'seguisb.ttf') if big else (54, 'segoeui.ttf')
        y = f'(h/2)-{110 if len(lines) > 1 else 60}' if big else f'(h/2)+{50 + (i - 1) * 74}'
        out.append(f"drawtext=fontfile='{FONT}{font}':textfile='{tf.as_posix().replace(':', chr(92) + ':')}':fontsize={size}:fontcolor=white:alpha='{alpha}'"
                   f":x=(w-tw)/2:y={y}:shadowcolor=black@0.7:shadowx=0:shadowy=4:borderw=1:bordercolor=black@0.25")
    return out

clips = plan['clips']
legs = [leave(c.get('transition')) for c in clips]   # legs[i]: how clip i leaves
segs = []   # (path, seconds, how it joins the previous one)
for i, c in enumerate(clips):
    src = next(clips_dir.glob(f'clip-{i + 1:02d}-*.mp4'))
    speed = float(c.get('speed') or 1)
    n = round((c['out'] - c['in']) / speed * FPS)
    lost = round(PRE * FPS) + round(c['record'] / speed * FPS) - count(src)
    if not 0 <= lost <= 3: sys.exit(f'clip {i + 1}: {lost} frames lost, re-shoot it')
    a = round(PRE * FPS) - lost + round(c['in'] / speed * FPS)
    vf = [f'scale=in_range=full:out_range=limited,trim=start_frame={a}:end_frame={a + n},setpts=N/{FPS}/TB']
    if i and legs[i - 1][0] == 'dip': vf.append(f'fade=t=in:st=0:d={legs[i - 1][1] / 2}')
    if legs[i][0] == 'dip': vf.append(f'fade=t=out:st={n / FPS - legs[i][1] / 2:.4f}:d={legs[i][1] / 2}')
    seg = work / f'seg{i + 1:02d}.mp4'
    if not seg.exists() or seg.stat().st_mtime < src.stat().st_mtime:   # a re-shot clip is re-cut, the rest reused
        run(['-i', str(src), '-vf', ','.join(vf + ['format=yuv420p']), '-an', *ENC, str(seg)])
    segs.append([seg, n / FPS, legs[i - 1] if i else ('cut', 0)])

if plan.get('titleCard'):   # held on clip 1's first frame, the text fading in and out
    t = dict(plan['titleCard'], _name='title'); d = float(t['seconds'])
    a = f'if(lt(t,0.4),t/0.4,if(gt(t,{d - 0.4}),({d}-t)/0.4,1))'
    dim = f"eq=brightness='-0.22*({a})':eval=frame"   # the frame darkens under the text, back to normal for the cut
    run(['-i', str(segs[0][0]), '-vf', ','.join([f'trim=end_frame=1,loop=loop={round(d * FPS) - 1}:size=1,setpts=N/{FPS}/TB', dim] + text_filters(t, a)), *ENC, str(work / 'title.mp4')])
    segs.insert(0, [work / 'title.mp4', round(d * FPS) / FPS, ('cut', 0)])
if plan.get('endCard'):
    e = dict(plan['endCard'], _name='end'); d = float(e['seconds'])
    run(['-f', 'lavfi', '-i', f'color=c=black:s=1920x1080:r={FPS}:d={d}', '-vf', ','.join(text_filters(e) + ['fade=t=in:st=0:d=0.5', f'fade=t=out:st={d - 0.6}:d=0.6']), *ENC, str(work / 'end.mp4')])
    segs.append([work / 'end.mp4', round(d * FPS) / FPS, legs[-1]])

inputs, chain, acc, last = [], [], 0, None
for k, (p, d, (kind, td)) in enumerate(segs):
    inputs += ['-i', str(p)]
    chain.append(f'[{k}:v]settb=1/{FPS}[i{k}]')   # concat and xfade need one timebase
    if k == 0: acc, last = d, '[i0]'; continue
    lab = f'[v{k}]'
    if kind == 'dissolve':
        chain.append(f'{last}[i{k}]xfade=transition=fade:duration={td}:offset={acc - td:.4f}{lab}')
        acc += d - td
    else:
        chain.append(f'{last}[i{k}]concat=n=2:v=1:a=0,settb=1/{FPS}{lab}')
        acc += d
    last = lab
run([*inputs, '-filter_complex', ';'.join(chain), '-map', last, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high',
     '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out])
print(f'{len(segs)} segments, {acc:.2f} s -> {out}')
