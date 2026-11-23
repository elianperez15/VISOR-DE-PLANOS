/* ──────────────────────────────────────────────────────────────────────
   ifc-names.ts — Nombres en español de las categorías IFC

   El IFC nombra cada elemento por su clase (IFCWALL, IFCSLAB…). Para quien
   no es arquitecto eso no dice nada: aquí se traduce a "Muros", "Losas"…
   Varias clases comparten nombre (IFCWALL e IFCWALLSTANDARDCASE son muros):
   el árbol del edificio las agrupa bajo el mismo.
   ────────────────────────────────────────────────────────────────────── */

const CATEGORY_NAMES: Record<string, string> = {
  IFCWALL: 'Muros',
  IFCWALLSTANDARDCASE: 'Muros',
  IFCWALLELEMENTEDCASE: 'Muros',
  IFCCURTAINWALL: 'Muros cortina',
  IFCSLAB: 'Losas',
  IFCROOF: 'Techos',
  IFCCOLUMN: 'Columnas',
  IFCBEAM: 'Vigas',
  IFCMEMBER: 'Perfiles y montantes',
  IFCPLATE: 'Placas y paneles',
  IFCFOOTING: 'Cimentaciones',
  IFCPILE: 'Pilotes',
  IFCREINFORCINGBAR: 'Varillas de refuerzo',
  IFCREINFORCINGMESH: 'Mallas de refuerzo',
  IFCDOOR: 'Puertas',
  IFCWINDOW: 'Ventanas',
  IFCSTAIR: 'Escaleras',
  IFCSTAIRFLIGHT: 'Tramos de escalera',
  IFCRAMP: 'Rampas',
  IFCRAMPFLIGHT: 'Tramos de rampa',
  IFCRAILING: 'Barandas',
  IFCCOVERING: 'Recubrimientos y cielos',
  IFCFURNISHINGELEMENT: 'Mobiliario',
  IFCFURNITURE: 'Mobiliario',
  IFCSPACE: 'Espacios',
  IFCOPENINGELEMENT: 'Aberturas',
  IFCBUILDINGELEMENTPROXY: 'Otros elementos',
  IFCFLOWSEGMENT: 'Tuberías y ductos',
  IFCPIPESEGMENT: 'Tuberías',
  IFCDUCTSEGMENT: 'Ductos',
  IFCFLOWFITTING: 'Accesorios de instalaciones',
  IFCFLOWTERMINAL: 'Aparatos y terminales',
  IFCSANITARYTERMINAL: 'Aparatos sanitarios',
  IFCLIGHTFIXTURE: 'Luminarias',
  IFCFLOWCONTROLLER: 'Válvulas y controles',
  IFCDISTRIBUTIONELEMENT: 'Instalaciones',
  IFCSITE: 'Terreno',
  IFCBUILDING: 'Edificio',
  IFCBUILDINGSTOREY: 'Nivel',
};

/** "IFCWALLSTANDARDCASE" → "Muros". Una clase sin traducir se muestra legible: "IFCFOOBAR" → "Foobar". */
export function categoryName(category: string | null | undefined): string {
  if (!category) return 'Sin categoría';
  const known = CATEGORY_NAMES[category.toUpperCase()];
  if (known) return known;
  const bare = category.replace(/^IFC/i, '').toLowerCase();
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}
