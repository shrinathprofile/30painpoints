"""demo_api — fixture app under test: a small, believable items API.

Import-safe by design (no network, no env, no DB): docs_drift imports it,
and so does every check. The spec snapshots in this folder were exported
from this app, then openapi-drifted.json was aged by hand (see BUILD-LOG).
"""

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="demo-api", version="1.2.0")


class Item(BaseModel):
    name: str
    qty: int = 1


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/items/{item_id}")
def get_item(item_id: int, verbose: bool = False) -> dict:
    if item_id < 1:
        raise HTTPException(404)
    return {"id": item_id, "verbose": verbose}


@app.get("/search")
def search(q: str, limit: int = 20) -> dict:
    return {"q": q, "limit": limit}


@app.post("/items")
def create_item(item: Item, x_request_id: str = Header(default="")) -> dict:
    return {"id": 42, "name": item.name, "request_id": x_request_id}


@app.delete("/items/{item_id}")
def delete_item(item_id: int) -> dict:
    return {"deleted": item_id}
