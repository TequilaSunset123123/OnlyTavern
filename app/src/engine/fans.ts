// Fan names and profiles from faker, driven by our seeded rng so they are
// reproducible. Used by crowd comments and by regulars.
import { base, en, Faker, zh_CN } from '@faker-js/faker'
import type { Settings } from '../store/schema'
import type { Rng } from './rng'

export type Language = 'en' | 'zh'

const FAKERS: Record<Language, Faker> = { en: new Faker({ locale: [en, base] }), zh: new Faker({ locale: [zh_CN, en, base] }) }
const MIX_CHINESE_SHARE = 0.3

export function pickLanguage(rng: Rng, setting: Settings['fanLanguage']): Language {
  return setting === 'mix' ? (rng() < MIX_CHINESE_SHARE ? 'zh' : 'en') : setting
}

/** Display name and @handle. */
export function fanIdentity(rng: Rng, language: Language): { name: string; handle: string } {
  const faker = FAKERS[language]
  faker.seed(Math.floor(rng() * 2 ** 31))
  const name = language === 'zh' ? faker.person.fullName() : faker.person.firstName()
  FAKERS.en.seed(Math.floor(rng() * 2 ** 31))
  return { name, handle: FAKERS.en.internet.username().toLowerCase() }
}

/** Where they live, age and a one-line background (templates, no model; plan.md §4.4). */
export function fanBackground(rng: Rng, language: Language): { country: string; age: number; bio: string } {
  const faker = FAKERS[language]
  faker.seed(Math.floor(rng() * 2 ** 31))
  const age = 21 + Math.floor(rng() * 35)
  if (language === 'zh') {
    const city = faker.location.city()
    return { country: '中国', age, bio: `${age}岁，住在${city}` }
  }
  const job = FAKERS.en.person.jobTitle()
  const city = FAKERS.en.location.city()
  const country = FAKERS.en.location.country()
  return { country, age, bio: `${age}, ${job.toLowerCase()} from ${city}, ${country}` }
}
