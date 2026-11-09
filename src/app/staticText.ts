import { t } from '../i18n';

/** Fill every `data-i18n` / `data-i18n-attr` element in the static shell. */
export function applyStaticText(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as string);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset.i18nAttr as string).split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  document.title = `Aurea · ${t('brand.tagline')}`;
}
