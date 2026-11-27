const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.main-nav');
const form = document.querySelector('#enquiry-form');
const status = document.querySelector('#form-status');

function setText(id, value) { const node = document.getElementById(id); if (node && value != null) node.textContent = value; }
function setLink(id, href, label) { const node = document.getElementById(id); if (!node) return; node.href = href; if (label != null) node.textContent = label; }
function createListItem(className, icon, title, description) {
  const article = document.createElement('article');
  if (className) article.className = className;
  const mark = document.createElement('span'); mark.textContent = icon || '✦'; article.append(mark);
  if (description !== undefined) { const p = document.createElement('p'); const b = document.createElement('b'); b.textContent = title; const small = document.createElement('small'); small.textContent = description; p.append(b, small); article.append(p); }
  else { const label = document.createElement('span'); label.textContent = title; article.append(label); }
  return article;
}

function renderSiteContent(site) {
  document.title = site.pageTitle || document.title;
  const description = document.querySelector('#page-description'); if (description) description.content = site.metaDescription || '';
  for (const [key, value] of Object.entries(site.theme || {})) document.documentElement.style.setProperty('--' + key, value);
  setText('brand-company-name', site.companyName || 'Formal Electrical');
  setText('brand-company-subtitle', '');
  setText('brand-tagline', site.hero?.tagline || '');
  setText('footer-company-name', site.companyName);
  const logo = document.querySelector('#brand-logo'); if (logo && site.logoUrl) logo.src = site.logoUrl + '?v=' + encodeURIComponent(site.hasUploadedLogo ? 'company' : 'default');
  if (logo) logo.alt = (site.companyName || 'Company') + ' logo';
  document.body.classList.toggle('has-uploaded-logo', Boolean(site.hasUploadedLogo));
  document.querySelectorAll('[data-site-nav]').forEach((node) => { const label = site.nav?.[node.dataset.siteNav]; if (label) node.textContent = label; });
  const hero = site.hero || {};
  for (const [id, value] of [['hero-title', hero.title], ['hero-tagline', hero.tagline], ['hero-intro', hero.intro], ['hero-primary-label', hero.primaryLabel], ['hero-secondary-label', hero.secondaryLabel]]) setText(id, value);
  const heroImage = document.querySelector('#hero-image'); if (heroImage && hero.imageAlt) heroImage.alt = hero.imageAlt;
  const services = document.querySelector('#services'); if (services) { services.replaceChildren(...(site.services || []).map((item) => { const a = document.createElement('a'); a.href = '#contact'; const icon = document.createElement('span'); icon.textContent = item.icon; const title = document.createElement('span'); title.textContent = item.title; a.append(icon, title); return a; })); }
  const about = site.about || {};
  for (const [id, value] of [['about-eyebrow', about.eyebrow], ['about-title', about.title], ['about-body', about.body], ['about-button-label', about.buttonLabel]]) setText(id, value);
  const aboutImage = document.querySelector('#about-image'); if (aboutImage && about.imageAlt) aboutImage.alt = about.imageAlt;
  const values = document.querySelector('#safety'); if (values) { values.replaceChildren(...(site.values || []).map((item) => createListItem('', item.icon, item.title, item.description))); values.style.setProperty('--value-count', String((site.values || []).length)); }
  const benefits = document.querySelector('#projects'); if (benefits) {
    const cards = (site.benefits || []).map((item) => createListItem('benefit', item.icon, item.title, item.description));
    const cta = document.createElement('a'); cta.href = '#contact'; cta.className = 'benefit-cta'; cta.append(document.createTextNode('Get in Touch Today ')); const arrow = document.createElement('span'); arrow.className = 'arrow-circle'; arrow.textContent = '➜'; cta.append(arrow); benefits.replaceChildren(...cards, cta); benefits.style.setProperty('--benefit-count', String(cards.length));
  }
  const contact = site.contact || {};
  for (const [id, value] of [['contact-eyebrow', contact.eyebrow], ['contact-title', contact.title], ['contact-intro', contact.intro], ['contact-button-label', contact.buttonLabel]]) setText(id, value);
  const phone = site.phone || '', phoneLink = 'tel:' + phone.replace(/[^\d+]/g, ''), email = site.email || '', mailLink = 'mailto:' + email;
  for (const id of ['top-phone', 'contact-phone']) setLink(id, phoneLink);
  for (const id of ['top-phone-text', 'contact-phone-text']) setText(id, phone);
  for (const id of ['top-email', 'contact-email', 'contact-email-cta']) setLink(id, id === 'contact-email-cta' ? mailLink + '?subject=Project%20enquiry' : mailLink);
  for (const id of ['top-email-text', 'contact-email-text']) setText(id, email);
  for (const id of ['top-address', 'contact-address']) setText(id, site.address);
  document.querySelectorAll('[data-site-social]').forEach((anchor) => { const url = site.social?.[anchor.dataset.siteSocial]; anchor.href = url || '#'; anchor.hidden = !url; anchor.rel = url ? 'noopener noreferrer' : ''; });
  const sections = site.sections || {};
  for (const [key, selector] of [['services', '#services'], ['about', '.about'], ['safety', '#safety'], ['projects', '#projects'], ['contact', '#contact']]) { const node = document.querySelector(selector); if (node) node.hidden = sections[key] === false; }
  document.querySelectorAll('.main-nav a[href^="#"]').forEach((link) => { const target = link.getAttribute('href').slice(1); if (Object.hasOwn(sections, target)) link.hidden = sections[target] === false; });
}

fetch('/api/site-content', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((data) => { if (data?.site) renderSiteContent(data.site); }).catch(() => {});

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('is-open', open);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('is-open');
  });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  status.className = 'form-status';
  if (!form.reportValidity()) return;

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.innerHTML = 'Sending… <span aria-hidden="true">↗</span>';

  try {
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'We could not send your enquiry. Please try again.');
    form.reset();
    status.textContent = 'Thank you. Your enquiry has been received and the team will follow up.';
    status.classList.add('is-success');
  } catch (error) {
    status.textContent = error.message === 'Failed to fetch'
      ? 'The enquiry service is unavailable at the moment. Please try again later.'
      : error.message;
    status.classList.add('is-error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Send project enquiry <span aria-hidden="true">↗</span>';
  }
});

