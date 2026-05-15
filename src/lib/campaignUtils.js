import prisma from './prisma.js'

export async function getCampaignContacts(campaign) {
  const baseWhere = { optedOut: false }

  if (campaign.contactIds?.length > 0) {
    return prisma.waContact.findMany({
      where: { id: { in: campaign.contactIds }, ...baseWhere },
    })
  }
  if (campaign.contactGroup) {
    return prisma.waContact.findMany({
      where: { group: campaign.contactGroup, ...baseWhere },
    })
  }
  return []
}
