const HSN_MAP = {
  // devices
  phone: "8517",
  mobile: "8517",
  smartphone: "8517",
  laptop: "8471",

  // accessories
  charger: "8504",
  powerbank: "8507",
  earphone: "8518",
  headphone: "8518",
  cable: "8544",
  cover: "3926"
};

const DEFAULT_ACCESSORY_HSN = "8504";

const normalize = (str = "") =>
  str
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

const getHSNByItem = ({ category = "", name = "" }) => {
  const normalizedCategory = normalize(category);
  const normalizedName = normalize(name);

  // 1️⃣ Accessories → detect by item name ONLY
  if (normalizedCategory === "accessories") {
    for (const key of Object.keys(HSN_MAP)) {
      // skip device keys while scanning accessories
      if (["phone", "mobile", "smartphone", "laptop"].includes(key)) continue;

      if (normalizedName.includes(key)) {
        return HSN_MAP[key];
      }
    }
    return DEFAULT_ACCESSORY_HSN; // guaranteed fallback
  }

  // 2️⃣ Phones & laptops (explicit, safe)
  if (["phone", "mobile", "smartphone"].includes(normalizedCategory)) {
    return "8517";
  }

  if (normalizedCategory === "laptop") {
    return "8471";
  }

  // 3️⃣ Absolute safety fallback (should never hit)
  return DEFAULT_ACCESSORY_HSN;
};

module.exports = { getHSNByItem };
