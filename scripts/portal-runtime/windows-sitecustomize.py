"""Keep CPython private temporary directories usable inside the portal sandbox."""

import os

if os.name == "nt" and os.environ.get("HEART_PORTAL_SANDBOX") == "1":
    import ctypes
    import sys
    from ctypes import wintypes

    _kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    _advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    _advapi.OpenProcessToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)
    ]
    _advapi.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)
    ]
    _advapi.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    ]
    _advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p
    ]
    _kernel.LocalFree.argtypes = [ctypes.c_void_p]
    _kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    _kernel.CreateDirectoryW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p]

    _token = wintypes.HANDLE()
    if not _advapi.OpenProcessToken(wintypes.HANDLE(-1), 8, ctypes.byref(_token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        _size = wintypes.DWORD()
        # TokenAppContainerSid: the marker alone must not affect host Python.
        _advapi.GetTokenInformation(_token, 31, None, 0, ctypes.byref(_size))
        _buffer = ctypes.create_string_buffer(_size.value)
        if not _advapi.GetTokenInformation(_token, 31, _buffer, _size, ctypes.byref(_size)):
            raise ctypes.WinError(ctypes.get_last_error())
        _sid = ctypes.cast(_buffer, ctypes.POINTER(ctypes.c_void_p))[0]
        if _sid:
            _sid_text = ctypes.c_void_p()
            if not _advapi.ConvertSidToStringSidW(_sid, ctypes.byref(_sid_text)):
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                # CPython 0700 protects SY/BA/OWNER RIGHTS but omits the package
                # SID required by AppContainer's second access check. Keep that
                # private DACL and add only this sandbox, without inheriting ACEs.
                _sddl = (
                    "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)"
                    "(A;OICI;FA;;;" + ctypes.wstring_at(_sid_text) + ")"
                )
            finally:
                _kernel.LocalFree(_sid_text)
    finally:
        _kernel.CloseHandle(_token)

    if _sid:
        class _SecurityAttributes(ctypes.Structure):
            _fields_ = [
                ("length", wintypes.DWORD),
                ("descriptor", ctypes.c_void_p),
                ("inherit", wintypes.BOOL),
            ]

        _mkdir = os.mkdir
        _temp_roots = tuple(
            os.path.normcase(os.path.abspath(os.environ[key])).rstrip("\\") + "\\"
            for key in ("TMPDIR", "TMP", "TEMP") if os.environ.get(key)
        )

        def _sandbox_mkdir(path, mode=0o777, *, dir_fd=None):
            candidate = os.path.abspath(os.fsdecode(path))
            if (mode != 0o700 or dir_fd is not None
                    or not os.path.normcase(candidate).startswith(_temp_roots)):
                return _mkdir(path, mode, dir_fd=dir_fd)
            sys.audit("os.mkdir", path, mode, -1)
            descriptor = ctypes.c_void_p()
            if not _advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                _sddl, 1, ctypes.byref(descriptor), None
            ):
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                attributes = _SecurityAttributes(
                    ctypes.sizeof(_SecurityAttributes), descriptor, False
                )
                if not _kernel.CreateDirectoryW(candidate, ctypes.byref(attributes)):
                    raise ctypes.WinError(ctypes.get_last_error())
            finally:
                _kernel.LocalFree(descriptor)

        os.mkdir = _sandbox_mkdir
