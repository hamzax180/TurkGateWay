import py_compile, glob, sys
files = glob.glob('backend/*.py') + glob.glob('backend/*/*.py') + glob.glob('backend/smart_router/*.py') + glob.glob('backend/models/*.py')
print('Compiling', len(files), 'files')
errs = False
for f in files:
    try:
        py_compile.compile(f, doraise=True)
        print('OK', f)
    except Exception as e:
        print('ERR', f, e)
        errs = True
if errs:
    sys.exit(1)
else:
    sys.exit(0)
