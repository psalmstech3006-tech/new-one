import { rng } from '../city/geom.js';

// Deterministic identity for a resident: who they are is a pure function of their id and
// their (already deterministic) schedule, so every client agrees on "Maya Chen, barista".
// Identity is read-only data for dialogue/UI; it never drives the simulation.

const FIRST = {
  f: ['Maya', 'Priya', 'Elena', 'Grace', 'Amara', 'Sofia', 'Hana', 'Lucia', 'Nadia', 'Chloe', 'Imani', 'Rosa', 'Yuki', 'Leah', 'Zara', 'Ines', 'Aisha', 'Margot', 'Tess', 'Keiko', 'Fatima', 'Olive', 'June', 'Carmen'],
  m: ['Daniel', 'Marcus', 'Theo', 'Samir', 'Kofi', 'Luis', 'Owen', 'Hiro', 'Jonah', 'Rafael', 'Andre', 'Felix', 'Omar', 'Caleb', 'Ivan', 'Tomas', 'Malik', 'Arjun', 'Declan', 'Wes', 'Eli', 'Mateo', 'Gideon', 'Ray'],
};
const LAST = ['Chen', 'Okafor', 'Rivera', 'Novak', 'Haddad', 'Kowalski', 'Mensah', 'Park', 'Silva', 'Brennan', 'Sato', 'Dubois', 'Ahmed', 'Lindqvist', 'Moreau', 'Osei', 'Petrov', 'Reyes', 'Tanaka', 'Walsh', 'Nguyen', 'Costa', 'Fischer', 'Adeyemi', 'Kaur', 'Morales', 'Byrne', 'Ito'];

export const TRAITS = {
  friendly: { greet: ['Hey there!', 'Oh, hi!', 'Hello! Nice evening, isn\'t it?'], bye: ['Take care!', 'See you around!', 'Bye now!'], filler: ['Ha, fair enough.', 'Oh? Tell me more.', 'I hear you.'] },
  chatty: { greet: ['Hi hi! Oh, you\'re new around here, aren\'t you?', 'Well hello! I was just thinking nobody talks to each other anymore.'], bye: ['Okay, okay, I\'ll let you go. Bye!', 'Lovely chatting — bye!'], filler: ['Honestly, same. Anyway, did you hear about the new place on Main St?', 'Ha! That reminds me of my cousin.'] },
  reserved: { greet: ['Hello.', 'Oh — hi.', 'Yes?'], bye: ['Bye.', 'Okay. Goodbye.'], filler: ['Hm.', 'I suppose.', 'I wouldn\'t know.'] },
  grumpy: { greet: ['What do you want?', 'Make it quick.', 'Yeah?'], bye: ['Finally.', 'Yeah, yeah. Bye.'], filler: ['Don\'t care.', 'Is that supposed to mean something?', 'Uh-huh.'] },
  formal: { greet: ['Good evening.', 'Hello. Can I help you?'], bye: ['Good day to you.', 'Goodbye.'], filler: ['I see.', 'That\'s one way of looking at it.', 'Interesting.'] },
};

// occupation from the workplace family (what they do there)
const JOB = {
  mixedUse: (name) => /CAFE|BEAN|DINER|GRILL/i.test(name) ? 'barista' : /PHARM/i.test(name) ? 'pharmacist' : 'shop assistant',
  convenience: () => 'cashier', mall: () => 'retail worker', supermarket: () => 'stocker', gas: () => 'attendant at the gas station',
  bank: () => 'bank teller', hotel: () => 'hotel receptionist', dealership: () => 'car salesperson',
  school: () => 'teacher', police: () => 'police officer', clinic: () => 'nurse', fire: () => 'firefighter', cityhall: () => 'city clerk',
  library: () => 'librarian', community: () => 'community worker', train: () => 'station staff', bus: () => 'bus driver',
  officeLow: () => 'accountant', officeTower: () => 'software developer', warehouse: () => 'warehouse worker', factory: () => 'machinist',
  workshop: () => 'mechanic', gym: () => 'personal trainer', cinema: () => 'cinema usher',
};

export function identityOf(resident) {
  if (resident.identity) return resident.identity;
  const r = rng(resident.id * 7919 + 13), dna = resident.dna || {};
  const frame = dna.frame === 'f' ? 'f' : 'm';
  const first = FIRST[frame][Math.floor(r() * FIRST[frame].length)], last = LAST[Math.floor(r() * LAST.length)];
  const traitNames = Object.keys(TRAITS), trait = dna.age > 60 && r() < 0.4 ? 'formal' : traitNames[Math.floor(r() * traitNames.length)];
  const work = resident.plan?.find((p) => ['work', 'school'].includes(p.act));
  const age = dna.age || 30;
  let job = 'between jobs';
  if (work?.act === 'school') job = age < 19 ? 'student' : 'teacher';
  else if (work) { const f = work.place.b?.meta?.family; job = JOB[f] ? JOB[f](work.place.name || '') : 'office worker'; }
  else if (age > 64) job = 'retired';
  const likes = ['coffee', 'jazz', 'the harbour at sunset', 'basketball', 'old cars', 'gardening', 'crime novels', 'cooking', 'running', 'chess', 'photography', 'the cinema on 3rd St'];
  resident.identity = { name: `${first} ${last}`, first, last, trait, job, age, workplace: work?.place?.name, home: resident.home?.name, likes: likes[Math.floor(r() * likes.length)] };
  return resident.identity;
}
