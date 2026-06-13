export const fr = {
  shop: "Boutique", search: "Rechercher", checkout: "Commander", cart: "Panier",
  name: "Nom", phone: "Téléphone", email: "E-mail", address: "Adresse",
  delivery: "Livraison", pickup: "Retrait", pay: "Payer", order: "Commande",
  total: "Total", discount: "Réduction", unavailable: "Indisponible",
  retry: "Réessayer", loading: "Chargement", receipt: "Reçu", tracking: "Suivre la commande",
} satisfies Record<keyof typeof import("./en").en, string>;
