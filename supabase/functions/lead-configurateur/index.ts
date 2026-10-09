// Martingale : remontée des clients du configurateur vers le CRM (table prospects).
// Appelé par config.martingaleparis.fr avec le jeton de session du client
// (projet Supabase "Configurateur Martingale", séparé du CRM).
// Le jeton est vérifié auprès du configurateur, puis la fiche et la configuration
// sont relues avec ce même jeton : un client ne peut envoyer que ses propres données.
// verify_jwt = false : le jeton vient d'un autre projet, on le vérifie nous-mêmes.

import { createClient } from "jsr:@supabase/supabase-js@2";

const USER_ID = "e0ea9ee1-90e8-4162-9e80-d264b7f993fb";
const SOURCE = "Client configurateur";
const CFG_URL = "https://hykwzwvfqohkakyrgwyf.supabase.co";
const CFG_KEY = "sb_publishable_AzkM2sDdJe5NtbrbI6-z_A_h-J8fkO6";

function originOk(o: string | null): boolean {
  if (!o) return false;
  return o === "https://config.martingaleparis.fr" ||
    /^https:\/\/(www\.)?martingaleparis\.(fr|com)$/.test(o) ||
    /^https:\/\/configurateur-martingale[a-z0-9-]*\.vercel\.app$/.test(o) ||
    /^http:\/\/localhost:\d+$/.test(o);
}
function cors(o: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": originOk(o) ? o! : "https://config.martingaleparis.fr",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function clean(v: unknown, max = 500): string {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}
function toQty(raw: unknown): number {
  const n = parseInt(String(raw ?? "").replace(/\D/g, ""), 10) || 0;
  return n > 0 && n < 100000 ? n : 0;
}

const FORMES: Record<string, string> = { tradition: "Tradition", harpe: "Harpe", resille: "Résille", ogive: "Ogive" };

async function cfg(path: string, token: string) {
  const r = await fetch(`${CFG_URL}${path}`, { headers: { apikey: CFG_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return await r.json();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  const rep = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return rep(405, { ok: false });
  if (!originOk(origin)) return rep(403, { ok: false, error: "origin" });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return rep(401, { ok: false });

  // 1. Qui est le client ? (vérifié par le configurateur)
  const user = await cfg("/auth/v1/user", token);
  if (!user || !user.id || !user.email) return rep(401, { ok: false, error: "session" });

  let body: Record<string, unknown> = {};
  try { body = JSON.parse((await req.text()).slice(0, 5000) || "{}"); } catch { /* vide */ }
  const evenement = ["inscription", "pdf", "devis"].includes(String(body.evenement)) ? String(body.evenement) : "inscription";
  const configId = clean(body.config_id, 60);

  // 2. Sa fiche pro et, si besoin, la configuration concernée (lues avec son jeton)
  const profils = await cfg(`/rest/v1/profils?id=eq.${user.id}&select=*`, token);
  const profil = Array.isArray(profils) && profils[0] ? profils[0] : {};
  let conf: Record<string, any> | null = null;
  if (configId && /^\d+$|^[0-9a-f-]{36}$/i.test(configId)) {
    const rows = await cfg(`/rest/v1/configurations?id=eq.${configId}&select=*`, token);
    conf = Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  const email = clean(user.email, 200).toLowerCase();
  const etab = clean(profil.etablissement, 200);
  const nom = clean(profil.nom, 200);
  const metier = clean(profil.metier, 60);
  const tel = clean(profil.telephone, 60);
  const terrasse = clean(profil.terrasse, 20);
  const det = (conf && conf.details) || {};
  const qty = evenement === "devis" ? toQty(det.quantite) : 0;

  const titre = { inscription: "Inscription configurateur", pdf: "Fiche PDF téléchargée", devis: "Demande de devis configurateur" }[evenement];
  const lignes = [`--- ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${titre}`];
  if (metier) lignes.push(`Profil : ${metier}`);
  if (etab) lignes.push(`Établissement : ${etab}`);
  if (terrasse) lignes.push(`Terrasse : ${terrasse} places`);
  if (tel) lignes.push(`Tel : ${tel}`);
  if (conf && conf.config) {
    const c = conf.config;
    lignes.push(`Chaise : ${FORMES[c.shape] || c.shape || "?"} · tressage ${c.weave || "?"} · couleurs ${[c.c1, c.c2, c.c3, c.c5].filter(Boolean).join(" / ")} · contour ${c.c4 || "?"}`);
    if (conf.reference) lignes.push(`Référence fiche : ${conf.reference}`);
  }
  if (qty) lignes.push(`Quantité demandée : ${qty} chaises`);
  if (det.message) lignes.push(`Message :\n${clean(det.message, 4000)}`);
  const note = lignes.join("\n");

  const produit = conf && conf.config
    ? [{ name: `Chaise ${FORMES[conf.config.shape] || conf.config.shape} sur mesure (configurateur)`, id: null, url: null, qty: qty || null }]
    : [];
  const score = Math.max(qty >= 50 ? 90 : qty >= 20 ? 70 : qty >= 10 ? 55 : 0,
    evenement === "devis" ? 50 : evenement === "pdf" ? 40 : 30,
    toQty(terrasse) >= 40 ? 45 : 0);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const { data: ex } = await sb.from("prospects")
      .select("id, notes, qty, produits, name, tel, contact, profil, source, score")
      .eq("user_id", USER_ID).ilike("email", email).limit(1).maybeSingle();

    if (ex) {
      const src = ex.source || "";
      const upd: Record<string, unknown> = {
        notes: ex.notes ? `${ex.notes}\n\n${note}` : note,
        qty: Math.max(ex.qty || 0, qty),
        produits: [...(Array.isArray(ex.produits) ? ex.produits : []), ...produit].slice(-20),
        name: etab || ex.name,
        contact: ex.contact || nom || null,
        tel: ex.tel || tel || null,
        profil: metier || ex.profil,
        source: src.includes(SOURCE) ? src : (src ? `${src} · ${SOURCE}` : SOURCE),
        score: Math.max(ex.score || 0, score),
        date_updated: new Date().toISOString(),
      };
      const { error } = await sb.from("prospects").update(upd).eq("id", ex.id);
      if (error) throw error;
      return rep(200, { ok: true, mode: "updated" });
    }

    const { error } = await sb.from("prospects").insert({
      user_id: USER_ID,
      name: etab || nom || email,
      contact: nom || null,
      email,
      tel: tel || null,
      profil: metier || null,
      source: SOURCE,
      statut: "Nouveau",
      qty,
      produits: produit,
      score,
      notes: note,
      utm: origin,
    });
    if (error) throw error;
    return rep(200, { ok: true, mode: "created" });
  } catch (e) {
    console.error("lead-configurateur", e);
    return rep(500, { ok: false, error: "db" });
  }
});
