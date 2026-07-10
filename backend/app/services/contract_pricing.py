"""
Contract pricing engine for the Anillo Quote Tool.

Loads the consolidated contract database (Anillo rows only) + the Top-100 parts
list, and prices a (part, customer, quantity) line per the agreed formula:

  1. part not in Top-100                     -> out of scope
  2. part has no Anillo contract price       -> flagged (no baseline)
  3. (part x customer) on an Anillo contract -> that contract price, bucket-matched
  4. part on contract, other customer        -> highest contract price x 1.40 (qty>=50k)
                                                                        x 1.60 (qty<50k)
Data files are loaded lazily and cached in memory.
"""
from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass

import openpyxl

_HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/
CONTRACT_DB_PATH = os.environ.get("CONTRACT_DB_PATH", os.path.join(_HERE, "data", "contract_db.xlsx"))
TOP100_PATH = os.environ.get("TOP100_PATH", os.path.join(_HERE, "data", "top100.xlsx"))
CONTRACT_SITE = os.environ.get("CONTRACT_SITE", "Anillo")

QTY_THRESHOLD = 50_000
MARKUP_HIGH_VOL = 1.40   # qty >= threshold
MARKUP_LOW_VOL = 1.60    # qty <  threshold

_CUST_SUFFIXES = {"INC", "INCORPORATED", "CO", "COMPANY", "LLC", "LTD", "CORP",
                  "CORPORATION", "GMBH", "THE", "AND", "LP", "PLC", "SA", "NV", "BV"}


def norm_part(s) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def norm_cust(s) -> str:
    if not s:
        return ""
    words = re.sub(r"[^A-Z0-9 ]", " ", str(s).upper()).split()
    return " ".join(w for w in words if w not in _CUST_SUFFIXES)


@dataclass
class ContractRec:
    customer_name: str
    customer_id: str
    price: float | None
    bucket_pricing: bool
    buckets: list[tuple[float, float]]   # (max_qty, price), ascending


@dataclass
class PriceResult:
    in_scope: bool
    flagged: bool
    rule: str                # 'out_of_scope' | 'no_contract' | 'contract' | 'markup_40' | 'markup_60' | 'ambiguous_customer'
    unit_price: float | None
    baseline: float | None = None
    matched_customer: str | None = None
    reason: str = ""


class PricingEngine:
    def __init__(self):
        self._loaded = False
        self._lock = threading.Lock()
        self.top100: set[str] = set()
        self.by_part: dict[str, list[ContractRec]] = {}
        self.customers: list[str] = []          # distinct display names for the dropdown

    # ------------------------------------------------------------------ #
    def ensure_loaded(self):
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._load()
            self._loaded = True

    def _load(self):
        # Top-100 parts
        wt = openpyxl.load_workbook(TOP100_PATH, data_only=True, read_only=True).active
        for row in wt.iter_rows(values_only=True):
            v = row[0] if row else None
            if v and str(v).strip().lower() not in ("row labels", "part number"):
                self.top100.add(norm_part(v))

        # Contract DB (Anillo only, Top-100 parts only)
        wb = openpyxl.load_workbook(CONTRACT_DB_PATH, data_only=True, read_only=True)
        ws = wb["Consolidated Contracts"] if "Consolidated Contracts" in wb.sheetnames else wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        hdr = [(" ".join(str(h).split()) if h else "") for h in next(it)]

        def find(prefix):
            for i, h in enumerate(hdr):
                if h.startswith(prefix):
                    return i
            return None

        i_site = 1
        i_part = find("Part Number")
        i_price = find("Current Price")
        i_cust = find("Customer Name (Site)")
        i_custid = find("Customer ID (Site)")
        i_bkt = find("Bucket Pricing")
        i_b1max = find("Bucket 1 Max")
        i_b1price = find("Bucket 1 Price")

        cust_set: set[str] = set()
        for row in it:
            if row[i_part] is None:
                continue
            if str(row[i_site]).strip() != CONTRACT_SITE:
                continue
            pn = norm_part(row[i_part])
            if pn not in self.top100:
                continue
            price = row[i_price] if isinstance(row[i_price], (int, float)) else None
            bkt = row[i_bkt] in (True, "True", "TRUE")
            buckets = []
            if i_b1max is not None and i_b1price is not None:
                # 11 bucket tiers laid out contiguously: maxes then prices
                for k in range(11):
                    mx = row[i_b1max + k] if i_b1max + k < len(row) else None
                    pr = row[i_b1price + k] if i_b1price + k < len(row) else None
                    if isinstance(mx, (int, float)) and isinstance(pr, (int, float)):
                        buckets.append((float(mx), float(pr)))
            cust_name = str(row[i_cust]).strip() if row[i_cust] else ""
            cust_id = str(row[i_custid]).strip() if i_custid is not None and row[i_custid] else ""
            self.by_part.setdefault(pn, []).append(
                ContractRec(cust_name, cust_id, price, bkt, buckets)
            )
            if cust_name:
                cust_set.add(cust_name)
        self.customers = sorted(cust_set)

    # ------------------------------------------------------------------ #
    @staticmethod
    def _bucket_price(rec: ContractRec, qty) -> float | None:
        if rec.bucket_pricing and rec.buckets:
            q = qty if isinstance(qty, (int, float)) else None
            if q is None:
                return rec.buckets[0][1]
            for mx, pr in rec.buckets:          # ascending by max
                if q <= mx:
                    return pr
            return rec.buckets[-1][1]            # above the top tier
        return rec.price

    def _match_customer(self, recs: list[ContractRec], customer: str):
        """Return (matched_rec_or_None, ambiguous: bool).

        Match on EXACT normalized customer name (or customer id). No fuzzy /
        containment matching: the quote names a specific entity, and a loose
        match would e.g. tie 'Boeing Distribution Services' to 'THE BOEING
        COMPANY' (which normalizes to 'BOEING'). Anything not on contract for
        the exact entity correctly falls through to the markup path.
        """
        cn = norm_cust(customer)
        if not cn:
            return None, False
        cid = str(customer).strip()
        matches = [r for r in recs
                   if norm_cust(r.customer_name) == cn or (r.customer_id and r.customer_id == cid)]
        if not matches:
            return None, False
        prices = {r.price for r in matches}
        return matches[0], len(prices) > 1

    def price(self, part: str, customer: str, qty) -> PriceResult:
        self.ensure_loaded()
        pn = norm_part(part)
        if pn not in self.top100:
            return PriceResult(False, False, "out_of_scope", None, reason="Not in Top-100")
        recs = self.by_part.get(pn)
        if not recs:
            return PriceResult(True, True, "no_contract", None,
                               reason="No Anillo contract price for this part")
        matched, ambiguous = self._match_customer(recs, customer)
        if matched and not ambiguous:
            return PriceResult(True, False, "contract", self._bucket_price(matched, qty),
                               matched_customer=matched.customer_name,
                               reason="Contract price (bucket-matched)")
        if matched and ambiguous:
            return PriceResult(True, True, "ambiguous_customer", None,
                               reason="Customer matches multiple contracts with different prices")
        # case 4 — markup off highest contract price
        prices = [r.price for r in recs if isinstance(r.price, (int, float))]
        if not prices:
            return PriceResult(True, True, "no_contract", None, reason="No numeric contract price")
        baseline = max(prices)
        q = qty if isinstance(qty, (int, float)) else 0
        markup = MARKUP_HIGH_VOL if q >= QTY_THRESHOLD else MARKUP_LOW_VOL
        rule = "markup_40" if q >= QTY_THRESHOLD else "markup_60"
        return PriceResult(True, False, rule, round(baseline * markup, 4), baseline=baseline,
                           reason=f"Highest contract price {baseline} x {markup}")


engine = PricingEngine()
