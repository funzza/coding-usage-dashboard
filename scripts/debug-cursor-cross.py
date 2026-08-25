"""配合 debug-float-cross.cjs:跨屏拖拽复现。
球初始在主屏 (300,600) DIP,中心 (332,632)。
拖拽路径:向左跨越边界 x=0 到副屏 (-400,600) DIP。
坐标换算:主屏 scale 1.0 => 物理=DIP;副屏 scale 1.25 => 物理=DIP*1.25。
之后移开再悬停到球上,观察振荡。
"""
import ctypes
import json
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)
u = ctypes.windll.user32
LOG = 'cross.log'

def to_physical(dip_x, dip_y):
    if dip_x >= 0:  # 主屏 1.0x
        return dip_x, dip_y
    return dip_x * 1.25, dip_y * 1.25  # 副屏 1.25x

def pos(dip_x, dip_y):
    px, py = to_physical(dip_x, dip_y)
    u.SetCursorPos(int(round(px)), int(round(py)))

def left_down():
    u.mouse_event(0x02, 0, 0, 0, 0)

def left_up():
    u.mouse_event(0x04, 0, 0, 0, 0)

def wait_marker(marker, timeout=90):
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
# 1) 跨屏拖拽:主屏 (300,600) -> 副屏 (-400,600),步进 8 DIP
pos(332, 632)
time.sleep(0.5)
left_down()
time.sleep(0.3)
steps = 92  # 732 DIP / 8 ≈ 92 步
for i in range(1, steps + 1):
    pos(332 - i * 8, 632)
    time.sleep(0.06)
left_up()
print('cross drag done')

wait_marker('HOVER2_BEGIN')
# 2) 先移开,再悬停到球(当前位置)的圆环上沿
pos(500, 300)
time.sleep(1.0)
b = latest_bounds()
cx = b['x'] + b['width'] / 2
cy = b['y'] + b['height'] / 2 - 18  # 圆环描边处
pos(cx, cy)
print('hover2 at', cx, cy, 'bounds:', b)
