"""设备端的固定路径与存档 glob（adb shell 里用的那一套）。"""

REMOTE_SAVE_ROOTS = (
    '/data/data/{pkg}/files',
    '/data/user/0/{pkg}/files',
    '/sdcard/Android/data/{pkg}/files',
    '/mnt/shared/MuMuShared/{pkg}/files',
)
# 存档文件的 glob（相对上面的 root）
REMOTE_SAVE_GLOB = '*/server*/dat.db'

__all__ = ['REMOTE_SAVE_GLOB', 'REMOTE_SAVE_ROOTS']
