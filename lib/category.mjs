// What kind of piece something is, from its title. Used to keep the swipes and edits varied
// (not forty dresses) and to leave out things that don't belong (kids' clothes, gift cards).

const RULES = [
  ['skip', /\b(gift ?card|e-?gift|voucher|swatch|personali[sz]ed|shipping|insurance|donation|kids?|child|children|baby|babies|toddler|junior|mini ?me|bundle|test product|mystery)\b/i],
  ['intimates', /\b(bra|bralette|briefs?|g-?string|knickers?|underwear|lingerie|boyshorts?|shapewear|pyjamas?|pajamas?)\b/i],
  ['swim', /\b(bikini|swim\w*|swimsuit|one[- ]piece|tankini|rash ?vest|boardshorts?|sarong)\b/i],
  ['shoes', /\b(shoes?|sneakers?|trainers?|boots?(?![- ]?cut)|booties|heels?|pumps?|sandals?|slides?|mules?|loafers?|clogs?|espadrilles?|slingbacks?|mary ?janes?|ballet flats?)\b/i],
  ['bags', /\b(bag|tote|clutch|crossbody|handbag|backpack|purse|wallet|pouch|satchel|hobo)\b/i],
  ['jewellery', /\b(earrings?|necklace|bracelet|bangle|rings?|pendant|anklet|brooch|hoops?|studs?|charm|signet)\b/i],
  ['dress', /\b(dress|gown|kaftan|caftan|pinafore|playsuit|jumpsuit|romper|boilersuit)\b/i],
  ['outerwear', /\b(coat|jacket|blazer|trench|parka|puffer|gilet|cape|bomber|overcoat|shacket|anorak)\b/i],
  ['knit', /\b(knit\w*|jumper|sweater|cardigan|pullover|crewneck|turtleneck|sweatshirt|hoodie|fleece)\b/i],
  ['bottoms', /\b(pants?|trousers?|jeans?|skirt|shorts?|culottes?|leggings?|joggers?|chinos?|cargos?|skort)\b/i],
  ['accessories', /\b(sunglasses|eyewear|optical|hat|bucket hat|baseball cap|cap(?![- ]?sleeve)|beanie|beret|scarf|belt|gloves?|socks?|tights|hair ?clip|claw clip|scrunchie|headband|umbrella|key ?ring|keychain)\b/i],
  ['top', /\b(tops?|tee|t-shirt|tshirt|shirt|blouse|tank|cami|camisole|bodysuit|singlet|polo|tunic|corset|bustier|halter|vest)\b/i],
  ['food', /\b(chocolate|tea|coffee|wine|olive oil|chilli|chili|sauce|honey|biscuits?|cookies?|jam|spices?|pasta|snacks?)\b/i],
  ['beauty', /\b(serum|moisturi[sz]er|cleanser|lipstick|lip|balm|fragrance|perfume|eau de|parfum|soap|cream|oil|mask|toner|mist|nail|polish|shampoo|conditioner|body wash|lotion|spf|sunscreen|blush|mascara)\b/i],
  ['home', /\b(vase|candles?|ceramic|glass(es)?|tumblers?|bowls?|plates?|cups?|mugs?|jug|carafe|teapot|lamp|cushion|pillow|throw|blanket|towels?|napkins?|tablecloth|bedding|duvet|incense|tray|planter|pot|chair|stool|table|rug|mirror|art print|poster|artwork|frame|book|diffuser|coasters?|cutlery|spoons?|platter|basket|dish|holder|object|sculpture|tiles?|enamel)\b/i],
];

export function categorize(title = '', extra = '') {
  const t = `${title} ${extra}`;
  for (const [cat, re] of RULES) if (re.test(t)) return cat;
  return 'other';
}

// The first 40 swipes: a wide spread across what she might love, fashion first but not only.
export const CALIBRATION_MIX = {
  dress: 4, top: 4, knit: 3, outerwear: 3, bottoms: 4, swim: 2, shoes: 4, bags: 4,
  jewellery: 3, accessories: 2, home: 5, beauty: 1, food: 1,
};

// Share of tonight's candidates any one category may take, so Claude sees a real spread.
export const CANDIDATE_CAP = 0.2;
