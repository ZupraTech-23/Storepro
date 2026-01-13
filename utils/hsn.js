const HSN_MAP = {
  mobile: "8517",
  smartphone: "8517",

  laptop: "8471",

  // accessory sub-types
  charger: "8504",
  powerbank: "8507",
  earphone: "8518",
  headphone: "8518",
  cable: "8544",
  cover: "3926"
};

// fallback for generic accessories
const DEFAULT_ACCESSORY_HSN = "8504";

const normalize = (str = "") =>
  str.toLowerCase().replace(/\s+/g, "");

const getHSNByItem = ({ category, name }) => {
  const normalizedName = normalize(name);

  // 1️⃣ Accessories → detect by item name
  if (category?.toLowerCase() === "accessories") {
    for (let key in HSN_MAP) {
      if (normalizedName.includes(key)) {
        return HSN_MAP[key];
      }
    }
    return DEFAULT_ACCESSORY_HSN;
  }

  // 2️⃣ Non-accessory categories
  const normalizedCategory = normalize(category);
  return HSN_MAP[normalizedCategory] || null;
};

module.exports = { getHSNByItem };
