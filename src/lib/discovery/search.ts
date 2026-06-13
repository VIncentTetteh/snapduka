export type DiscoveryCandidate={id:string;quality:number;updatedAt:string;active:boolean};
export function rankDiscovery(rows:DiscoveryCandidate[],now=new Date()){return rows.filter(row=>row.active&&now.getTime()-new Date(row.updatedAt).getTime()<30*86_400_000).sort((a,b)=>b.quality-a.quality||a.id.localeCompare(b.id))}
