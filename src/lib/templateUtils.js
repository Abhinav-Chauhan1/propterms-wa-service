export function resolveTemplate(body, contact, extraVars = {}) {
  return body
    .replace(/\{\{name\}\}/g, contact.name ?? '')
    .replace(/\{\{flat_no\}\}/g, extraVars.flat_no ?? '')
    .replace(/\{\{rent\}\}/g, extraVars.rent ?? '')
    .replace(/\{\{property_link\}\}/g, extraVars.property_link ?? '')
    .replace(/\{\{locality\}\}/g, extraVars.locality ?? '')
    .replace(/\{\{owner_name\}\}/g, extraVars.owner_name ?? '')
}
