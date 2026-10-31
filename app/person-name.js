/* GEOTRACIA 1.6 — Estándar global: APELLIDOS, NOMBRES.
   No infiere ni invierte cadenas de texto libre. Prioriza identidad estructurada. */
(()=>{'use strict';
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const folded=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-CL');
const placeholders=new Set(['identidad pendiente','desarrollo','usuario','user','sin nombre','n/a','null','undefined']);
const valid=value=>{const v=clean(value);return !!v&&!placeholders.has(folded(v));};
function formatPersonName(person,fallback=''){
 if(typeof person==='string'){
  const direct=clean(person);
  if(valid(direct))return direct;
  const safeFallback=clean(fallback);
  return valid(safeFallback)?safeFallback:'Identidad pendiente';
 }
 const source=person&&typeof person==='object'?person:{};
 const given=clean(source.given_names||source.first_names||source.first_name);
 const family=clean(source.family_names||source.last_names||source.last_name);
 if(given&&family)return `${family}, ${given}`;
 if(family&&valid(family))return family;
 if(given&&valid(given))return given;
 const candidates=[source.display_name,source.full_name,source.name,source.member_name];
 const display=candidates.map(clean).find(valid);
 if(display)return display;
 const email=clean(source.email||source.auth_email||source.user_email);
 const safeFallback=clean(fallback);
 if(valid(safeFallback))return safeFallback;
 if(email)return `Identidad pendiente · ${email}`;
 return 'Identidad pendiente';
}
function initials(value){
 const text=clean(typeof value==='object'?formatPersonName(value):formatPersonName(value));
 if(!text||folded(text).startsWith('identidad pendiente'))return 'ID';
 const parts=text.replace(/,/g,' ').split(/\s+/).filter(Boolean);
 return parts.slice(0,2).map(x=>Array.from(x)[0]||'').join('').toLocaleUpperCase('es-CL')||'ID';
}
function hasInstitutionalOrder(value){return /^[^,]+,\s*[^,]+$/.test(clean(value));}
window.geotraciaFormatPersonName=formatPersonName;
window.geotraciaPersonInitials=initials;
window.geotraciaHasInstitutionalNameOrder=hasInstitutionalOrder;
})();
