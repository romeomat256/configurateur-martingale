/*
 * Comptes Martingale : accès en deux temps.
 * Sans compte : la chaise en 3D et le choix de la structure.
 * Avec compte : tressage, couleurs, Conseiller, fiche PDF et devis.
 * Connexion par lien e-mail (adresse vérifiée) ou avec Google, via Supabase (projet « Configurateur Martingale », Paris).
 */
(function(){
  var SUPABASE_URL = 'https://hykwzwvfqohkakyrgwyf.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_AzkM2sDdJe5NtbrbI6-z_A_h-J8fkO6';
  var CONFIG_KEY = 'martingale-config-en-cours';
  // ID client Google (public). Avec lui, Google affiche « Martingale » et config.martingaleparis.fr, jamais l'adresse Supabase.
  var GOOGLE_CLIENT_ID = '978712209854-oaakice5mh4bntbh5ekhm7eiu3b84jb4.apps.googleusercontent.com';

  var client = null, session = null, profil = null, pending = null, ready = false;
  try{
    if(window.supabase && window.supabase.createClient){
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'implicit' }
      });
    }
  }catch(err){ console.warn('Comptes indisponibles', err); }

  var CRM_LEAD_URL = 'https://hduxtygzhesmclxanocj.supabase.co/functions/v1/lead-configurateur';
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function redirectUrl(){ return location.origin + location.pathname; }
  function profilComplet(){ return !!(profil && profil.metier && profil.etablissement && profil.terrasse && profil.telephone); }

  // ── Fenêtre de connexion ──
  function injecter(){
    if($('acct-overlay')) return;
    var html =
    '<div class="acct-overlay" id="acct-overlay" role="dialog" aria-modal="true" aria-labelledby="acct-title">'+
      '<div class="acct-modal">'+
        '<button type="button" class="m-cls" aria-label="Fermer" onclick="MartingaleComptes.fermer()">×</button>'+
        '<div id="acct-step-login">'+
          '<div class="m-ey">Espace professionnel</div>'+
          '<h2 id="acct-title">Composez <em>votre chaise.</em></h2>'+
          '<p class="acct-intro">Créez votre compte gratuit pour choisir le tressage et les couleurs, utiliser le Conseiller Martingale et recevoir votre fiche.</p>'+
          '<div id="acct-gsi" class="acct-gsi"></div>'+
          '<button type="button" class="acct-google" id="acct-google-fallback" onclick="MartingaleComptes.google()">'+
            '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'+
            '<span>Continuer avec Google</span></button>'+
          '<div class="acct-or"><span>ou</span></div>'+
          '<form id="acct-form" onsubmit="event.preventDefault();MartingaleComptes.lien()">'+
            '<label class="fl" for="acct-email">E-mail professionnel</label>'+
            '<input class="fi" id="acct-email" type="email" required autocomplete="email" placeholder="vous@etablissement.fr">'+
            '<button type="submit" class="fsub acct-submit">Recevoir mon lien de connexion</button>'+
          '</form>'+
          '<p class="acct-status" id="acct-status" role="status"></p>'+
          '<p class="acct-legal">Pas de mot de passe : vous recevez un lien par e-mail. Vos informations servent uniquement à préparer vos fiches et vos devis.</p>'+
        '</div>'+
        '<div id="acct-step-profil" hidden>'+
          '<div class="m-ey">Votre fiche professionnelle</div>'+
          '<h2>Bienvenue <em>chez Martingale.</em></h2>'+
          '<p class="acct-intro">Quelques informations pour préparer vos fiches et vos devis.</p>'+
          '<form id="acct-profil-form" onsubmit="event.preventDefault();MartingaleComptes.enregistrerProfil()">'+
            '<div class="fg"><span class="fl" id="acct-metier-l">Vous êtes *</span><div class="acct-metiers" role="radiogroup" aria-labelledby="acct-metier-l">'+
              ['Restaurateur','Hôtelier','Décorateur','Architecte','Autre'].map(function(m,i){ return '<label><input type="radio" name="acct-metier" value="'+m+'" required><span>'+m+'</span></label>'; }).join('')+
            '</div></div>'+
            '<div class="fg"><label class="fl" for="acct-etab">Nom de l\'établissement *</label><input class="fi" id="acct-etab" required autocomplete="organization" placeholder="Restaurant, hôtel, café…"></div>'+
            '<div class="fg acct-range"><label class="fl" for="acct-terrasse">Taille de votre terrasse * <output id="acct-terrasse-val">40 places</output></label>'+
            '<input type="range" id="acct-terrasse" min="1" max="150" step="1" value="40" oninput="MartingaleComptes.terrasse(this.value)">'+
            '<div class="acct-range-bornes"><span>1</span><span>150 places</span></div></div>'+
            '<div class="fg"><label class="fl" for="acct-tel">Téléphone *</label><input class="fi" id="acct-tel" type="tel" required autocomplete="tel" pattern="[0-9+().\\s-]{8,}" placeholder="06 12 34 56 78"></div>'+
            '<button type="submit" class="fsub acct-submit">Commencer</button>'+
          '</form>'+
          '<p class="acct-status" id="acct-status-profil" role="status"></p>'+
        '</div>'+
      '</div>'+
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    $('acct-overlay').addEventListener('click', function(e){ if(e.target.id==='acct-overlay') fermer(); });
  }

  function ouvrir(etape){
    injecter();
    $('acct-step-login').hidden = etape!=='login';
    $('acct-step-profil').hidden = etape!=='profil';
    if(etape==='profil' && profil){
      $('acct-etab').value = profil.etablissement || '';
      Array.prototype.forEach.call(document.querySelectorAll('input[name=acct-metier]'), function(r){ r.checked = r.value===profil.metier; });
      $('acct-terrasse').value = parseInt(profil.terrasse,10) || 40; afficherTerrasse($('acct-terrasse').value);
      $('acct-tel').value = profil.telephone || '';
    }
    $('acct-overlay').classList.add('open');
    if(etape==='login') boutonGoogle();
    setTimeout(function(){ var f=$('acct-overlay').querySelector(etape==='login'?'#acct-email':'#acct-etab'); if(f) f.focus(); }, 50);
  }
  function afficherTerrasse(v){ var o=$('acct-terrasse-val'); if(o) o.textContent = v + (v==1?' place':' places'); }
  function fermer(){ var o=$('acct-overlay'); if(o) o.classList.remove('open'); }
  function status(id, txt, err){ var el=$(id); if(el){ el.textContent=txt||''; el.classList.toggle('err', !!err); } }

  // Garde la chaise en cours pendant l'aller-retour de connexion
  function sauverConfig(){
    try{ if(typeof S!=='undefined') sessionStorage.setItem(CONFIG_KEY, JSON.stringify({shape:S.shape,weave:S.weave,c1:S.c1,c2:S.c2,c3:S.c3,c4:S.c4,c5:S.c5,cat:S.cat})); }catch(e){}
  }
  function lireConfig(){
    try{ var raw=sessionStorage.getItem(CONFIG_KEY); if(!raw) return null; sessionStorage.removeItem(CONFIG_KEY); return JSON.parse(raw); }catch(e){ return null; }
  }

  // ── Bouton « Continuer avec Google » officiel (Google Identity Services) ──
  var gsiCharge=null, nonceBrut=null;
  function chargerGsi(){
    if(gsiCharge) return gsiCharge;
    gsiCharge=new Promise(function(res,rej){
      var sc=document.createElement('script'); sc.src='https://accounts.google.com/gsi/client'; sc.async=true;
      sc.onload=function(){res();}; sc.onerror=function(){rej(new Error('gsi'));}; document.head.appendChild(sc);
    });
    return gsiCharge;
  }
  async function sha256(txt){
    var buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  async function boutonGoogle(){
    var zone=$('acct-gsi'), repli=$('acct-google-fallback');
    if(!GOOGLE_CLIENT_ID || !zone){ if(zone) zone.hidden=true; if(repli) repli.hidden=false; return; }
    try{
      await chargerGsi();
      nonceBrut=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      var nonceHash=await sha256(nonceBrut);
      google.accounts.id.initialize({ client_id:GOOGLE_CLIENT_ID, callback:retourGoogle, nonce:nonceHash, use_fedcm_for_prompt:true, itp_support:true, context:'signin', ux_mode:'popup' });
      zone.innerHTML='';
      google.accounts.id.renderButton(zone,{ type:'standard', theme:'outline', size:'large', shape:'pill', text:'continue_with', logo_alignment:'center', width:Math.min(380, zone.clientWidth||380), locale:'fr' });
      zone.hidden=false; if(repli) repli.hidden=true;
    }catch(err){ zone.hidden=true; if(repli) repli.hidden=false; }
  }
  async function retourGoogle(rep){
    if(!client || !rep || !rep.credential) return;
    status('acct-status','Connexion en cours…');
    var r=await client.auth.signInWithIdToken({ provider:'google', token:rep.credential, nonce:nonceBrut });
    if(r.error){ status('acct-status','Connexion Google impossible : '+r.error.message,true); return; }
    status('acct-status','');
  }

  async function google(){
    if(!client) return status('acct-status','La connexion est momentanément indisponible.',true);
    sauverConfig();
    var r = await client.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: redirectUrl() } });
    if(r.error) status('acct-status','Connexion Google impossible : '+r.error.message,true);
  }
  async function lien(){
    if(!client) return status('acct-status','La connexion est momentanément indisponible.',true);
    var email = $('acct-email').value.trim();
    if(!email) return;
    sauverConfig();
    status('acct-status','Envoi en cours…');
    var r = await client.auth.signInWithOtp({ email:email, options:{ emailRedirectTo: redirectUrl(), shouldCreateUser:true } });
    if(r.error) status('acct-status','Envoi impossible : '+r.error.message,true);
    else status('acct-status','Lien envoyé à '+email+'. Ouvrez votre boîte mail et cliquez sur le lien pour continuer.');
  }

  async function chargerProfil(){
    if(!client || !session) { profil=null; return; }
    var r = await client.from('profils').select('*').eq('id', session.user.id).maybeSingle();
    profil = r.data || { id:session.user.id, email:session.user.email };
    if(!profil.nom && session.user.user_metadata) profil.nom = session.user.user_metadata.full_name || session.user.user_metadata.name || '';
  }
  async function enregistrerProfil(){
    if(!client || !session) return;
    var maj = {
      nom: profil && profil.nom ? profil.nom : null,
      metier: (document.querySelector('input[name=acct-metier]:checked')||{}).value || null,
      etablissement: $('acct-etab').value.trim(),
      terrasse: $('acct-terrasse').value,
      telephone: $('acct-tel').value.trim(),
      maj_le: new Date().toISOString()
    };
    status('acct-status-profil','Enregistrement…');
    var r = await client.from('profils').update(maj).eq('id', session.user.id).select().maybeSingle();
    if(r.error){ status('acct-status-profil','Enregistrement impossible : '+r.error.message,true); return; }
    profil = r.data || Object.assign(profil||{}, maj);
    status('acct-status-profil','');
    fermer(); majEntete(); preRemplir(); lancerAttente();
    versCrm('inscription');
  }

  function ok(){ return !!(session && profilComplet() && !(profil && profil.bloque)); }

  function lancerAttente(){ var f=pending; pending=null; if(f && ok()) setTimeout(f, 60); }

  // Demande un compte avant une action réservée
  function exiger(action){
    if(ok()){ if(action) action(); return true; }
    pending = action || null;
    if(session && profil && profil.bloque){ alerteBloque(); return false; }
    ouvrir(session ? 'profil' : 'login');
    return false;
  }
  function alerteBloque(){
    ouvrir('login');
    status('acct-status','Votre accès est suspendu. Contactez-nous : contact@martingaleparis.fr', true);
  }

  async function deconnexion(){ if(client) await client.auth.signOut(); session=null; profil=null; majEntete(); if(typeof openStep==='function') openStep(0); }

  function majEntete(){
    var el = $('hdr-ref'); if(!el) return;
    if(session && profil){
      var prenom = (profil.nom||profil.email||'').split(' ')[0];
      el.innerHTML = '<span class="acct-name">'+esc(prenom)+'</span><button type="button" class="acct-link" onclick="MartingaleComptes.deconnexion()">Se déconnecter</button>';
    } else {
      el.innerHTML = '<button type="button" class="acct-link" onclick="MartingaleComptes.exiger()">Se connecter</button>';
    }
    document.body.classList.toggle('acct-ok', ok());
  }

  function preRemplir(){
    if(!profil) return;
    var set=function(id,v){ var e=$(id); if(e && !e.value && v) e.value=v; };
    set('fi-n', profil.nom); set('fi-p', profil.etablissement); set('fi-e', profil.email || (session&&session.user.email)); set('fi-t', profil.telephone);
    var q=$('fi-q'), tp=parseInt(profil.terrasse,10); if(q && tp && !q.dataset.touche && typeof qtySync==='function'){ q.dataset.touche='1'; qtySync(tp,'init'); }
    set('ep-ent', profil.etablissement); set('ep-email', profil.email || (session&&session.user.email));
  }

  // Historique : chaque fiche ou devis est rattaché au compte
  async function noter(action, reference, details){
    if(!client || !session || typeof S==='undefined') return;
    try{
      var r = await client.from('configurations').insert({ user_id:session.user.id, action:action, reference:reference||null,
        config:{shape:S.shape,weave:S.weave,c1:S.c1,c2:S.c2,c3:S.c3,c4:S.c4,c5:S.c5}, details:details||null }).select('id').single();
      versCrm(action, r.data && r.data.id);
    }catch(e){}
  }

  // Remonte le client dans le CRM Martingale (catégorie « Client configurateur »)
  function versCrm(evenement, configId){
    if(!session) return;
    try{
      fetch(CRM_LEAD_URL, { method:'POST', keepalive:true,
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+session.access_token },
        body: JSON.stringify({ evenement:evenement, config_id: configId||null }) }).catch(function(){});
    }catch(e){}
  }

  async function init(){
    injecter();
    majEntete();
    if(!client){ ready=true; return; }
    var r = await client.auth.getSession();
    session = r.data && r.data.session;
    if(session){ await chargerProfil(); }
    ready = true;
    majEntete(); preRemplir();
    if(session && !profilComplet()) ouvrir('profil');
    client.auth.onAuthStateChange(async function(evt, s){
      session = s;
      if(evt==='SIGNED_IN' || evt==='INITIAL_SESSION' || evt==='USER_UPDATED'){
        await chargerProfil(); majEntete(); preRemplir();
        if(session && !profilComplet()) ouvrir('profil'); else { fermer(); lancerAttente(); }
      }
      if(evt==='SIGNED_OUT'){ profil=null; majEntete(); }
    });
    // Nettoie l'adresse après le retour du lien de connexion
    if(/access_token|error_description/.test(location.hash)) history.replaceState(null,'',location.pathname+location.search);
  }

  window.MartingaleComptes = { terrasse:afficherTerrasse, exiger:exiger, ok:ok, fermer:fermer, google:google, lien:lien, enregistrerProfil:enregistrerProfil,
    deconnexion:deconnexion, noter:noter, lireConfig:lireConfig, preRemplir:preRemplir, init:init };
})();
