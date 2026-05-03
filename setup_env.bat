@echo off
set "PATH=C:\Program Files\nodejs;C:\Users\hadil\AppData\Local\Programs\Python\Python312;C:\Users\hadil\AppData\Local\Programs\Python\Python312\Scripts;%PATH%"
echo Installing NPM dependencies...
call npm install
echo Installing Python dependencies...
python -m pip install -r requirements.txt
echo Setup complete!
