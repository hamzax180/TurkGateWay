from fastapi import FastAPI
from backend.main import app as main_app

app = FastAPI()

# Mount the main app under /api so that Vercel routes like /api/auth/login
# get stripped of /api and passed to the main app as /auth/login
app.mount("/api", main_app)
