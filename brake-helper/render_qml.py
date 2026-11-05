#!/usr/bin/env python3
"""Render the brake helper QML in a few states to PNGs (offscreen Qt, no game needed).

    QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software python render_qml.py PNG_DIR OUT_DIR
"""
import os
import sys

from PySide6.QtCore import QTimer, QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine

DOTS = ["#34d27b", "#34d27b", "#3d8bff", "", "", "", "", ""]
STATES = {
    "1-straight": dict(fill=0.0, color="#f2f5f8", glow=False, label="", labelColor="#8d99a6",
                       current=3, biasDelta=0),
    "2-approach": dict(fill=0.45, color="#f2f5f8", glow=False, label="", labelColor="#8d99a6",
                       current=3, biasDelta=-2),
    "3-get-ready": dict(fill=0.85, color="#ff7a34", glow=False, label="Get ready", labelColor="#ffc53d",
                        current=3, biasDelta=0),
    "4-brake-point": dict(fill=1.0, color="#ff3b30", glow=True, label="Brake", labelColor="#ff3b30",
                          current=3, biasDelta=0),
    "5-braking": dict(fill=0.4, color="#ff3b30", glow=False, label="Braking", labelColor="#ff3b30",
                      current=3, biasDelta=0),
    "6-off-the-brake": dict(fill=0.0, color="#ff3b30", glow=False, label="Off the brake",
                            labelColor="#e9eef3", current=3, biasDelta=0),
    "7-result-later": dict(fill=1.0, color="#3d8bff", glow=False, label="Brake later", labelColor="#3d8bff",
                           current=3, biasDelta=1),
}


def main():
    png_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()
    engine.load(QUrl.fromLocalFile(os.path.join(png_dir, "apps/hud/ui/overlays/brake_helper/brake_helper.qml")))
    if not engine.rootObjects():
        print("QML failed to load")
        sys.exit(1)
    win = engine.rootObjects()[0]
    win.setProperty("scaleFactor", 2.0)
    names = list(STATES)

    def step(i=0):
        if i > 0:
            img = win.grabWindow()
            img.save(os.path.join(out_dir, names[i - 1] + ".png"))
            print("saved", names[i - 1], img.width(), img.height())
        if i == len(names):
            app.quit()
            return
        view = dict(STATES[names[i]], dots=DOTS, bias=56, biasKnown=True)
        win.updateView(view)
        QTimer.singleShot(400, lambda: step(i + 1))

    QTimer.singleShot(300, step)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
