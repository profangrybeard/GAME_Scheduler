@echo off
echo Starting SCAD Course Scheduler...
echo.
echo If this is your first time, run: pip install -r requirements.txt
echo.
python -m streamlit run app.py --server.headless true
pause
