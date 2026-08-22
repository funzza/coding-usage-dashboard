"""配合 debug-float-oscillate.cjs 的真实鼠标驱动(Windows ctypes):
1) 悬停:光标移到副屏球心并停住(1.25x DIP -> 物理像素 x1.25)
2) 移回主屏
3) 拖拽:按住左键向右移 125 物理 px(=100 DIP),松手
日志标记来自 oscillate.log(electron 侧输出)。
"""
import ctypes
import json
import re
import time

# 必须声明 Per-Monitor DPI Aware,否则 Windows 会对 SetCursorPos 的坐标做缩放虚拟化
ctypes.windll.shcore.SetProcessDpiAwareness(2)
u = ctypes.windll.user32
LOG = 'oscillate.log'

def pos(x, y):
    u.SetCursorPos(int(x), int(y))
    # 回读验证(DPI aware 后是物理像素)
    class P(ctypes.Structure):
        _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]
    p = P()
    u.GetCursorPos(ctypes.byref(p))
    return (p.x, p.y)

def left_down():
    u.mouse_event(0x02, 0, 0, 0, 0)

def left_up():
    u.mouse_event(0x04, 0, 0, 0, 0)

def wait_marker(marker, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with open(LOG, encoding='utf-8', errors='ignore') as f:
                if marker in f.read():
                    return
        except FileNotFoundError:
            pass
        time.sleep(0.3)
    raise TimeoutError(marker)

def latest_bounds():
    with open(LOG, encoding='utf-8', errors='ignore') as f:
        lines = [l for l in f if l.startswith('BOUNDS')]
    return json.loads(lines[-1][7:].strip())

wait_marker('BALL_READY')
# 瞄准圆环顶部描边(DIP 中心 (-1068,632) 上移 22 -> 物理 x1.25),避开中心透明区
print('hover: cursor at', pos(-1335, 762))

wait_marker('AWAY_PHASE_BEGIN')
pos(500, 500)
print('away: cursor back to primary')

wait_marker('DRAG_PHASE_BEGIN')
b = latest_bounds()
cx = (b['x'] + b['width'] / 2) * 1.25
cy = (b['y'] + b['height'] / 2) * 1.25
pos(cx, cy)
time.sleep(0.5)
left_down()
time.sleep(0.3)
for i in range(1, 13):
    pos(cx + 125 * i / 12, cy)
    time.sleep(0.08)
left_up()
print('drag: moved +125 physical px from', b)
