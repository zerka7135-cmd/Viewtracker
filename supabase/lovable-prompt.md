Un bot externe (ViewTracker) va envoyer les vues Instagram / TikTok / YouTube de chaque clipper. Mets en place uniquement la réception des données, en deux étapes. Ne crée ni ne modifie aucun écran ni aucun composant de l'interface pour l'instant.

## 1. Tables (migration)

```sql
create table if not exists public.daily_views (
  account_name text not null,
  day          date not null,
  clipper_id   uuid references public.clippers(id) on delete set null,
  views        integer not null default 0,
  views_ig     integer not null default 0,
  views_tt     integer not null default 0,
  views_yt     integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (account_name, day)
);
create index if not exists daily_views_clipper_day on public.daily_views (clipper_id, day);

create table if not exists public.account_views (
  account_name text primary key,
  clipper_id   uuid references public.clippers(id) on delete set null,
  total        bigint not null default 0,
  ig           bigint not null default 0,
  tt           bigint not null default 0,
  yt           bigint not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.daily_views enable row level security;
alter table public.account_views enable row level security;
```

Politiques de lecture (select) sur ces deux tables : mêmes règles que `daily_stats` (admin et manager voient tout, un clipper ne voit que les lignes de son clipper_id). Aucune politique d'écriture : seule l'Edge Function ci-dessous écrit, avec la clé service role.
Si `clippers.id` n'est pas un uuid, adapte le type de `clipper_id`.

## 2. Edge Function `ingest-views`

- Crée un secret `VIEWS_INGEST_SECRET` (je te donnerai la valeur).
- La fonction doit être appelable sans JWT : `verify_jwt = false` pour `ingest-views` dans `supabase/config.toml`.
- Code exact à utiliser :

```ts
import { createClient } from "npm:@supabase/supabase-js@2";

const FIELDS: Record<string, { conflict: string; ints: string[]; extra: string[] }> = {
  daily_views: { conflict: "account_name,day", ints: ["views", "views_ig", "views_tt", "views_yt"], extra: ["day"] },
  account_views: { conflict: "account_name", ints: ["total", "ig", "tt", "yt"], extra: ["updated_at"] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sameSecret(a: string, b: string) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const va = new Uint8Array(ha), vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

const nameKey = (s: unknown) => String(s ?? "").trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("VIEWS_INGEST_SECRET");
  if (!secret || !(await sameSecret(req.headers.get("x-ingest-secret") ?? "", secret))) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => null);
  const spec = FIELDS[body?.table];
  const rows = body?.rows;
  if (!spec || !Array.isArray(rows) || rows.length > 1000) return json({ error: "invalid payload" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: clippers, error: clippersError } = await supabase.from("clippers").select("id,discord_name");
  if (clippersError) return json({ error: clippersError.message }, 500);
  const clipperIdByName = new Map(clippers.map((c) => [nameKey(c.discord_name), c.id]));

  const clean = [];
  for (const r of rows) {
    const name = String(r?.account_name ?? "").trim();
    if (!name || name.length > 100) return json({ error: "invalid account_name" }, 400);
    const row: Record<string, unknown> = { account_name: name, clipper_id: clipperIdByName.get(nameKey(name)) ?? null };
    for (const k of spec.ints) {
      const v = Number(r[k] ?? 0);
      if (!Number.isInteger(v) || v < 0) return json({ error: `invalid ${k}` }, 400);
      row[k] = v;
    }
    if (spec.extra.includes("day")) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.day))) return json({ error: "invalid day" }, 400);
      row.day = r.day;
    }
    row.updated_at = spec.extra.includes("updated_at") && r.updated_at ? r.updated_at : new Date().toISOString();
    clean.push(row);
  }

  const { error } = await supabase.from(body.table).upsert(clean, { onConflict: spec.conflict });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, count: clean.length });
});
```

Donne-moi ensuite l'URL de la fonction ingest-views.
