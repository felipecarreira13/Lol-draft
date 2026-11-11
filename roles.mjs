import { readFileSync, writeFileSync } from 'node:fs';

const lanes = {
  top: 'Aatrox Akali Ambessa Aurora Camille Cassiopeia Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce Kayle Kennen Kled KSante Malphite Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Rengar Riven Rumble Ryze Sett Shen Singed Sion Skarner TahmKench Teemo Trundle Tryndamere Udyr Urgot Varus Vayne Vladimir Volibear Warwick MonkeyKing Yasuo Yone Yorick Zaahen Zac',
  jungle: 'Ambessa Amumu Belveth Brand Briar Diana Ekko Elise Evelynn Fiddlesticks Gragas Graves Gwen Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia Locke Maokai MasterYi MonkeyKing Morgana Naafiri Nidalee Nocturne Nunu Olaf Pantheon Poppy Qiyana Rammus RekSai Rengar Sejuani Shaco Shen Shyvana Skarner Sylas Taliyah Talon Teemo Trundle Udyr Vi Viego Volibear Warwick XinZhao Zaahen Zac Zed Zyra',
  mid: 'Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Cassiopeia Chogath Corki Diana Ekko Fizz Galio Gragas Heimerdinger Hwei Irelia Jayce Kassadin Katarina Leblanc Lissandra Locke Lucian Lux Malphite Malzahar Mel Naafiri Neeko Orianna Pantheon Qiyana Rumble Ryze Seraphine Smolder Swain Sylas Syndra Taliyah Talon Tristana TwistedFate Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zilean Zoe',
  bot: 'Aphelios Ashe Caitlyn Corki Draven Ezreal Jhin Jinx Kaisa Kalista KogMaw Lucian MissFortune Nilah Samira Senna Seraphine Sivir Smolder Swain Tristana Twitch Varus Vayne Xayah Yasuo Yunara Zeri Ziggs',
  support: 'Alistar Amumu Ashe Bard Blitzcrank Brand Braum Elise Galio Gragas Hwei Janna Karma Leona Lulu Lux Maokai Mel Milio Morgana Nami Nautilus Neeko Pantheon Poppy Pyke Rakan Rell Renata Senna Seraphine Sett Shaco Sona Soraka Swain TahmKench Taric Thresh Twitch Velkoz Xerath Yuumi Zilean Zoe Zyra',
};

const source = JSON.parse(readFileSync(process.argv[2] || 'riot-champions.tmp'));
const laneSets = Object.entries(lanes).map(([lane, ids]) => [lane, new Set(ids.split(' '))]);
const champions = Object.values(source.data).map(({ id, name, title, image }) => {
  const roles = laneSets.filter(([, ids]) => ids.has(id)).map(([lane]) => lane);
  if (!roles.length) throw new Error('Defina as rotas de ' + id);
  return { id, name, title, image: image.full, roles };
}).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
writeFileSync('ui/champions.json', JSON.stringify({ patch: source.version, champions }));

