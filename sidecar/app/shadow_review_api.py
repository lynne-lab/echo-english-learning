from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from . import llm, shadow_review

router = APIRouter(prefix="/api/shadowing", tags=["shadow-review"])


@router.get("/{material_id}/coverage")
def get_coverage(material_id: str) -> dict[str, Any]:
    try:
        return shadow_review.coverage(material_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{material_id}/review")
def create_review(material_id: str) -> dict[str, Any]:
    try:
        return shadow_review.generate(material_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{material_id}/reviews")
def list_reviews(material_id: str) -> list[dict[str, Any]]:
    return shadow_review.list_reviews(material_id)


@router.get("/reviews/{review_id}")
def get_review(review_id: str) -> dict[str, Any]:
    try:
        return shadow_review.get_review(review_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/reviews/{review_id}")
def delete_review(review_id: str) -> dict[str, bool]:
    try:
        shadow_review.delete_review(review_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}
