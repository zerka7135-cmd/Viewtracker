import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from scraping.instagram import scrape_instagram
from scraping.youtube import scrape_youtube

# Service interne, jamais exposé publiquement : appelé uniquement par le bot
# Node (voir src/scraperClient.js) sur le réseau privé Railway (ou en local).
# Si SCRAPER_SERVICE_TOKEN n'est pas défini, la vérification est simplement
# désactivée (pratique en dev local) — à toujours définir en production.
SCRAPER_SERVICE_TOKEN = os.environ.get("SCRAPER_SERVICE_TOKEN")

app = FastAPI(title="ViewTracker scraper-service")


def check_token(x_scraper_token: Optional[str]) -> None:
    if SCRAPER_SERVICE_TOKEN and x_scraper_token != SCRAPER_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Token invalide (X-Scraper-Token)")


class InstagramRequest(BaseModel):
    url: str
    postsLimit: int = Field(default=5, alias="postsLimit")
    cookies: list = []

    class Config:
        populate_by_name = True


class YoutubeRequest(BaseModel):
    url: str
    postsLimit: int = Field(default=5, alias="postsLimit")

    class Config:
        populate_by_name = True


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scrape/instagram")
def scrape_instagram_endpoint(body: InstagramRequest, x_scraper_token: Optional[str] = Header(None)):
    check_token(x_scraper_token)
    return scrape_instagram(body.url, body.postsLimit, body.cookies)


@app.post("/scrape/youtube")
def scrape_youtube_endpoint(body: YoutubeRequest, x_scraper_token: Optional[str] = Header(None)):
    check_token(x_scraper_token)
    return scrape_youtube(body.url, body.postsLimit)
