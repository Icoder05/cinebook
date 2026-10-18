/**
 * Offline catalogue used when TMDB_API_KEY is not set: real films in Indian cinemas
 * as of 17 Oct 2026, two per language, plus three coming soon. Ids, images and cast
 * come from TMDB; release dates and "now showing" status were cross-checked with
 * Sacnilk/Filmibeat box-office listings. Synopses are our own short summaries.
 *
 * It's a snapshot: add a TMDB key and run `npm run sync:tmdb` (or the admin "Sync from
 * TMDB" button) to pull the live now-playing list instead. Rows are keyed by tmdbId,
 * so a later sync updates these in place.
 */
export interface SnapshotMovie {
  tmdbId: number;
  title: string;
  overview: string | null;
  posterPath: string;
  backdropPath: string | null;
  runtimeMin: number | null;
  releaseDate: string;
  /** Original language first, then confirmed dubbed releases. */
  languages: string[];
  genres: string[];
  certificate: string | null;
  trailerKey: string | null;
  status: 'now_showing' | 'upcoming';
  cast: { name: string; character: string | null; profilePath: string | null }[];
}

export const SNAPSHOT_DATE = '2026-10-17';

export const SNAPSHOT_MOVIES: SnapshotMovie[] = [
  // ── Hindi ────────────────────────────────────────────────────────────────
  {
    tmdbId: 1269325,
    title: 'Drishyam: The Conclusion',
    overview:
      'Years after Vijay Salgaonkar outwitted the police, fresh evidence reopens the case. With his secret closer than ever to coming out, he must outsmart the system one last time to protect his family.',
    posterPath: '/7T62GSduOWDMB0gGDBs9pmtLTSB.jpg',
    backdropPath: '/nq73eRdEooripf3k0XHLtX14zyC.jpg',
    runtimeMin: 148,
    releaseDate: '2026-10-02',
    languages: ['Hindi'],
    genres: ['Thriller', 'Drama', 'Mystery', 'Crime'],
    certificate: 'UA16+',
    trailerKey: 'jYbEYF1t-hk',
    status: 'now_showing',
    cast: [
      { name: 'Ajay Devgn', character: 'Vijay Salgaonkar', profilePath: '/vnHQQFzTjJ0sv14DGMIoKa3qTxN.jpg' },
      { name: 'Jaideep Ahlawat', character: 'SP Rajveer Singh Tomar', profilePath: '/uILn4y8EWbMdeu71laMsh8zHY0M.jpg' },
      { name: 'Tabu', character: 'Meera Deshmukh', profilePath: '/cvt5nvCHr1ICf5u8A2mlzLQ8LsV.jpg' },
      { name: 'Shriya Saran', character: 'Nandini Salgaonkar', profilePath: '/ioOgKBSCJhOdKoZpg86ld7zANbf.jpg' },
      { name: 'Rajat Kapoor', character: 'Mahesh Deshmukh', profilePath: '/8IF24mMUSspmXHbxCMMbMaz3WRj.jpg' },
      { name: 'Prakash Raj', character: 'Public Prosecutor Indrajith Shetty', profilePath: '/dJvFZOXmZdkYCOUcKTXQAhBcAoH.jpg' },
    ],
  },
  {
    tmdbId: 1081010,
    title: 'Prahaar – The Ujjwal Nikam Story',
    overview:
      'After the 26/11 Mumbai attacks, public prosecutor Ujjwal Nikam leads the case against Ajmal Kasab — no guns, no bullets, only evidence and the truth.',
    posterPath: '/wTrBTNfHHmpPwiB9rpn0tGbSW1m.jpg',
    backdropPath: '/8S2DXdKY23wfYq4v0awYXov4c8g.jpg',
    runtimeMin: 141,
    releaseDate: '2026-10-16',
    languages: ['Hindi'],
    genres: ['Crime', 'Drama'],
    certificate: 'UA16+',
    trailerKey: 'rPZw29Zh6Oo',
    status: 'now_showing',
    cast: [
      { name: 'Rajkummar Rao', character: 'Ujjwal Nikam', profilePath: '/bCbQkvfnncgsh9qZ9u02IGtsfma.jpg' },
      { name: 'Wamiqa Gabbi', character: 'Jyoti Nikam', profilePath: '/e1CNXkH2scGeoabOTowFJJxX2YF.jpg' },
      { name: 'Jaideep Ahlawat', character: 'Chaudhary Zulfiqar Ali', profilePath: '/uILn4y8EWbMdeu71laMsh8zHY0M.jpg' },
      { name: 'Sikandar Kher', character: 'Abbas Kazmi', profilePath: '/sULXachczStfQLegNVmxcvuUTWZ.jpg' },
      { name: 'Lalit Prabhakar', character: 'Mohd. Ajmal Amir Kasab', profilePath: '/gdjKrQX2ITPhqFGcWRnEaYq0Wci.jpg' },
      { name: 'Nassar', character: 'P. Chidambaram', profilePath: '/p3I0tSQY3C5qZW3NzFfbpjKPNL6.jpg' },
    ],
  },

  // ── English ──────────────────────────────────────────────────────────────
  {
    tmdbId: 1153576,
    title: 'Street Fighter',
    overview:
      '1993. Estranged fighters Ryu and Ken Masters are pulled back into the ring when Chun-Li recruits them for the next World Warrior Tournament — where a conspiracy forces them to face each other, and their past.',
    posterPath: '/dJPT2Uf12X6aFg8i5N67NTpIZ9t.jpg',
    backdropPath: '/zDE9hd1SG9695YncbZGjSf7Z9Jk.jpg',
    runtimeMin: 120,
    releaseDate: '2026-10-16',
    languages: ['English', 'Hindi', 'Tamil'],
    genres: ['Action', 'Fantasy'],
    certificate: 'UA16+',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Andrew Koji', character: 'Ryu', profilePath: '/oU53nWLQ6wFHzERwSi1fD53LxZB.jpg' },
      { name: 'Noah Centineo', character: 'Ken Masters', profilePath: '/p1bcst401RyxfDGykx2iQLI7CV5.jpg' },
      { name: 'Callina Liang', character: 'Chun-Li', profilePath: '/blJ4iEqMs5oTiKVxUyB9Ky7kNRO.jpg' },
      { name: 'David Dastmalchian', character: 'M. Bison', profilePath: '/eLafwcpL64CqzwjjSgKpO7Rv4ae.jpg' },
      { name: 'Eric Andre', character: 'Don Sauvage', profilePath: '/e9XlcFnZQiBSQ1vISQVyTOrkIaq.jpg' },
      { name: 'Andrew Schulz', character: 'Dan Hibiki', profilePath: '/fdeYq1EraYvlYM3VmGXjIaSGoTz.jpg' },
    ],
  },
  {
    tmdbId: 1281331,
    title: 'The Social Reckoning',
    overview:
      'Facebook engineer Frances Haugen teams up with Wall Street Journal reporter Jeff Horwitz on a high-stakes effort to expose the social network’s most closely guarded secrets.',
    posterPath: '/7jK6NuxVg1XuEV7UdNa6KO03IgZ.jpg',
    backdropPath: '/wXTaGcqX3jvdXSKCJAkl5jZyrKp.jpg',
    runtimeMin: 113,
    releaseDate: '2026-10-09',
    languages: ['English'],
    genres: ['Drama', 'Thriller'],
    certificate: 'A',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Mikey Madison', character: 'Frances Haugen', profilePath: '/nsWQNYBTBYE2TCzGpyXTpA0TTEz.jpg' },
      { name: 'Jeremy Allen White', character: 'Jeff Horwitz', profilePath: '/pXRADDRhprgaQ4Bri44NH3bYeu6.jpg' },
      { name: 'Jeremy Strong', character: 'Mark Zuckerberg', profilePath: '/jcMhXWICSi4QjQttJVhFSiKVvpF.jpg' },
      { name: 'Betty Gilpin', character: 'Kris', profilePath: '/bNY6pwoztA95dzFCcvDQCs7TbbF.jpg' },
      { name: 'Bill Burr', character: 'Charlie Garrigan', profilePath: '/4U95TX23X97OK9csaKVwzqAjFUV.jpg' },
      { name: 'Wunmi Mosaku', character: 'Raya', profilePath: '/vp7qDA7cYZj0MDYk1k4wysmznnN.jpg' },
    ],
  },

  // ── Tamil ────────────────────────────────────────────────────────────────
  {
    tmdbId: 1234139,
    title: 'Jailer 2',
    overview:
      'Retired jailer ‘Tiger’ Muthuvel Pandian goes undercover as a driver to shield his family from a dangerous syndicate — and takes on a ruthless new set of enemies to defend his home.',
    posterPath: '/upwdEyhhYZ7pT2hD535fr2MGfpx.jpg',
    backdropPath: '/zpHTOdRl7GEPqFsDGqsN6Hi9Ylt.jpg',
    runtimeMin: 163,
    releaseDate: '2026-10-15',
    languages: ['Tamil', 'Hindi'],
    genres: ['Action', 'Comedy'],
    certificate: 'UA16+',
    trailerKey: 'YN5ddNbh8M8',
    status: 'now_showing',
    cast: [
      { name: 'Rajinikanth', character: "'Tiger' Muthuvel Pandian", profilePath: '/cQBcrXqcQPfXOQfNfgO3slJM2xi.jpg' },
      { name: 'S. J. Suryah', character: 'Bodhi Kalpak', profilePath: '/7Q8510XwxPU1193cteaFQsiq2rv.jpg' },
      { name: 'Mithun Chakraborty', character: 'Chakri Kalpak', profilePath: '/4z8c5YAe0TCkEZNHXWlKxNTD8sV.jpg' },
      { name: 'Suraj Venjaramoodu', character: 'Dileep', profilePath: '/2FUs0wmR3eHBd8g4GVbCmhkUzeI.jpg' },
      { name: 'Ramya Krishnan', character: "Vijayalakshmi 'Viji' Pandian", profilePath: '/7C1bj7z3XhqxjDIGoCs6MFJdSVa.jpg' },
      { name: 'Vidya Balan', character: 'Kantha Kalpak', profilePath: '/m4bnX5VQs2DfvQsLmfbKbBxUkC9.jpg' },
    ],
  },
  {
    tmdbId: 1515692,
    title: 'Baththa',
    overview:
      'Madras, 1986. A timid eight-year-old accidentally locks a feared gangster inside a deserted school toilet — and the two form an unlikely bond that changes both their lives.',
    posterPath: '/Ag59cmNNXCcKIBYdlmZ9HqPH9zG.jpg',
    backdropPath: '/xrAtBSFEYzcRRB5kOvtICSuOrok.jpg',
    runtimeMin: 159,
    releaseDate: '2026-10-01',
    languages: ['Tamil'],
    genres: ['Drama', 'Comedy', 'Action'],
    certificate: 'UA13+',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Vijay Sethupathi', character: "Bathvachalam 'Baththa'", profilePath: '/a3HWdfCAbplrvoMNEJCjnkbqqOo.jpg' },
      { name: 'Lijomol Jose', character: 'Kannima', profilePath: '/vXFBgF6NMON7L4RzZ6B35lOVYOu.jpg' },
      { name: 'Sai Prithviraj', character: 'Sabari', profilePath: null },
      { name: 'Sahasra Sree', character: "Thenmozhi 'Thenu'", profilePath: null },
      { name: 'Santhy Balachandran', character: 'Selvi', profilePath: '/gLpx6IM3Ifs6m1tytsc3yc4Lw90.jpg' },
      { name: 'Arjun Chidambaram', character: 'Jyoti', profilePath: '/yay74IONzoiC50I2Od5L5a0bcbm.jpg' },
    ],
  },

  // ── Telugu ───────────────────────────────────────────────────────────────
  {
    tmdbId: 1389379,
    title: 'Ranabaali',
    overview:
      'In 19th-century British India, a fierce leader rises from a drought-stricken land to fight colonial oppression and the atrocities inflicted on his people.',
    posterPath: '/aIzU9bVUvqphq8rPnvAS5N1Zd5o.jpg',
    backdropPath: '/xpImgnsxuqb3VOp0QRtXTS5uBRi.jpg',
    runtimeMin: 185,
    releaseDate: '2026-10-16',
    languages: ['Telugu', 'Hindi'],
    genres: ['Action', 'Drama', 'History'],
    certificate: null,
    trailerKey: 'x6DrZYnZFUw',
    status: 'now_showing',
    cast: [
      { name: 'Vijay Deverakonda', character: 'Ranabaali', profilePath: '/8oVIWyIoFUal8SJFnmCUtkkm1HP.jpg' },
      { name: 'Rashmika Mandanna', character: 'Jayamma', profilePath: '/lj16BGfdqygHF8PZVt2KO8GUXn1.jpg' },
      { name: 'Arnold Vosloo', character: 'Sir Theodore Hector', profilePath: '/o23Z1EvWEYR7PArq2w5UpreVipV.jpg' },
      { name: 'Vinod Sagar', character: null, profilePath: '/1TPybIW2ncqrA9G4q03R3MhUP0B.jpg' },
      { name: 'Easwari Rao', character: null, profilePath: '/fjyvQ45YZcovy2Egj2eux8UiuHU.jpg' },
    ],
  },
  {
    tmdbId: 1376856,
    title: 'The Paradise',
    overview:
      'Secunderabad, the 1980s. A marginalised tribe battles discrimination and fights for citizenship, rallying behind a leader who takes on the system that has kept them down.',
    posterPath: '/smghVMoMWSIFi5dgIz4w1UIcEcY.jpg',
    backdropPath: '/7AcH5TFppoMusNkCBLaQP6UOODp.jpg',
    runtimeMin: 173,
    releaseDate: '2026-09-23',
    languages: ['Telugu', 'Hindi'],
    genres: ['Action', 'Drama'],
    certificate: null,
    trailerKey: 'Rcvre4NPMxQ',
    status: 'now_showing',
    cast: [
      { name: 'Nani', character: "Sarakka 'Jadal'", profilePath: '/jfOH4sUWs3VXuGUlo0VLMYNRBQ4.jpg' },
      { name: 'Mohan Babu', character: 'Shikanja Maalik', profilePath: '/zwqcXtnk0ju0nhuhvZXSLL2nLIy.jpg' },
      { name: 'Kayadu Lohar', character: "Subbulakshmi 'Subbu'", profilePath: '/pHaMPnrfnWvTPZA4IOmZk8BHY0U.jpg' },
      { name: 'Sonali Kulkarni', character: 'Sammakka', profilePath: '/aQeM6N2JgGFbI5VoltWhkxw6OQC.jpg' },
      { name: 'Raghav Juyal', character: 'Vikram Maalik', profilePath: '/ncJa8IBYfDknQLpjeciaQy6dXkH.jpg' },
      { name: 'Sampoornesh Babu', character: 'Biriyani', profilePath: '/8LUNhS7JGsv5YDIX3qBPJP3f1BI.jpg' },
    ],
  },

  // ── Malayalam ────────────────────────────────────────────────────────────
  {
    tmdbId: 1508168,
    title: 'Bethlehem Kudumba Unit',
    overview:
      'Ashley comes home from abroad, and a wedding next door stirs up memories of her first love, Justin — in the biggest Malayalam hit of the year.',
    posterPath: '/uaSZiH6yoGaVJcqzKtrfSkqDuHX.jpg',
    backdropPath: '/zms3m4kVz7RXmobU1B0nhrvUEmP.jpg',
    runtimeMin: 155,
    releaseDate: '2026-08-21',
    languages: ['Malayalam'],
    genres: ['Romance', 'Comedy', 'Drama'],
    certificate: 'UA13+',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Nivin Pauly', character: 'Justin Davis', profilePath: '/5A4IZUUCBQsBs4tIrlsuqQP9urT.jpg' },
      { name: 'Mamitha Baiju', character: 'Ashley Thankachan', profilePath: '/9ySiE3j7ep16fhKi3u5iq5rbOk6.jpg' },
      { name: 'Sangeeth Prathap', character: 'Joel Davis', profilePath: '/2f7mTmZ1RttbacuADm6vv7xpTAi.jpg' },
      { name: 'Suresh Krishna', character: 'Baiju Xavier', profilePath: '/hQ4TZgh8IuUh1LJtxCRmUY45fo6.jpg' },
      { name: 'Bindu Panicker', character: 'Kunjanty', profilePath: '/18KNkcI2UpSASkztGHJCGDtw4bP.jpg' },
      { name: 'Vinay Forrt', character: 'Alex', profilePath: '/26P7CfxRs6Hay7xAkHAghDtvGzO.jpg' },
    ],
  },
  {
    tmdbId: 922673,
    title: 'The Third Murder',
    overview:
      'When businessman Boban is killed the same way as a drug peddler, DYSP Christy brings in ex-cop Swamy, a serial-killer specialist. The trail leads to a troubled teenager — and a race to stop a third murder.',
    posterPath: '/jNKwDvLdx81UqY4KVl0KybtSTqo.jpg',
    backdropPath: null,
    runtimeMin: 124,
    releaseDate: '2026-10-02',
    languages: ['Malayalam'],
    genres: ['Crime', 'Thriller', 'Mystery'],
    certificate: 'UA',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Vinay Forrt', character: 'Vinayan', profilePath: '/26P7CfxRs6Hay7xAkHAghDtvGzO.jpg' },
      { name: 'Saiju Kurup', character: 'Christy', profilePath: '/4NMeGiBEBjkmBcX5PStRHFOcrOu.jpg' },
      { name: 'Indrans', character: 'Swamy', profilePath: '/vs5Acy2hJ4dWoM3xRGdnFKdVXzw.jpg' },
      { name: 'Ananya', character: null, profilePath: '/kf4pJajOe6f5eoIQBbii7nFaa3W.jpg' },
      { name: 'Leona Lishoy', character: null, profilePath: '/4MKzSA8uvurHJc9xUxaGvbocI5B.jpg' },
      { name: 'Fara Shibla', character: null, profilePath: '/g83mDO2oHWkyxzOZNvAIAurZKTZ.jpg' },
    ],
  },

  // ── Kannada ──────────────────────────────────────────────────────────────
  {
    tmdbId: 1735270,
    title: 'Premada Oorali',
    overview:
      'A heartfelt village love story that weaves a romance together with a father-and-son drama — and became Sandalwood’s biggest sleeper hit of the year.',
    posterPath: '/d3tfAVRB9baqZqFnV6wPvqZnuzi.jpg',
    backdropPath: '/r22LSVD46wOY3rkavnM4gWc3sz2.jpg',
    runtimeMin: 155,
    releaseDate: '2026-09-25',
    languages: ['Kannada'],
    genres: ['Music', 'Family', 'Drama'],
    certificate: 'UA16+',
    trailerKey: null,
    status: 'now_showing',
    cast: [
      { name: 'Rangayana Raghu', character: 'Naganna', profilePath: '/zYvl4RCUkhSFCZ8paZ1H9lV6nJa.jpg' },
      { name: 'Shri Mahadev', character: 'Santosh', profilePath: '/ymPC1XQKvR7X3Xsh7b38uIwzTUs.jpg' },
      { name: 'Thapaswini', character: 'Rukmini', profilePath: '/4txmaMjrR5lCZOiM7Xe64gUaD8e.jpg' },
      { name: 'Ramika Shivu', character: 'Vasantha', profilePath: '/ydAzhlMFTuAXEak2EW8bzN0FpUh.jpg' },
      { name: 'Ilaa Vitla', character: 'Shanta', profilePath: null },
      { name: 'Devendra Naidu', character: 'Shivalingu', profilePath: null },
    ],
  },
  {
    tmdbId: 1213243,
    title: 'Toxic: A Fairy Tale for Grown-Ups',
    overview:
      'Behind a sun-soaked beach town, a drug cartel runs the show — and as Portuguese colonial rule crumbles, a violent fight for control of the underworld begins.',
    posterPath: '/5RTd3YCLWbEhbe9OXRuNX3pbT5U.jpg',
    backdropPath: '/tBRSSfgqOAq7YlG8udcoJIBm2FG.jpg',
    runtimeMin: 192,
    releaseDate: '2026-08-26',
    languages: ['Kannada', 'English', 'Hindi'],
    genres: ['Action', 'Crime', 'Drama'],
    certificate: 'A',
    trailerKey: 'cXymbHU5i-U',
    status: 'now_showing',
    cast: [
      { name: 'Yash', character: 'Raya', profilePath: '/ixHvgN8hGh8YgWd3j9RqUATvBiy.jpg' },
      { name: 'Kiara Advani', character: 'Nadia', profilePath: '/2xmU03a6kTWUvuTPMdofiFLxdAw.jpg' },
      { name: 'Nayanthara', character: 'Ganga', profilePath: '/sYUzvjsSsqeOgBblSzda6ZwwbEa.jpg' },
      { name: 'Huma Qureshi', character: 'Elizabeth', profilePath: '/nJWauZQdRjMJxwY3UP4SXrqh9CM.jpg' },
      { name: 'Tara Sutaria', character: 'Rebecca', profilePath: '/tF2OxFzOaDOMX1Sn4k17qZxhvFL.jpg' },
      { name: 'Rukmini Vasanth', character: 'Mellisa', profilePath: '/4LERfXpxgdAXwxixYOCPWFeQ800.jpg' },
    ],
  },

  // ── Coming soon ──────────────────────────────────────────────────────────
  {
    tmdbId: 1400940,
    title: 'Clayface',
    overview:
      'Gotham street kid turned Hollywood star Matt Hagen is left disfigured by a crime boss. Desperate, he turns to an experimental treatment that restores his face — but loosens his grip on reality.',
    posterPath: '/5jCpQnWPikggmQZoDp1eAi6BI6w.jpg',
    backdropPath: '/kVtOcoUJ68chBD2tmERkdWz7lK5.jpg',
    runtimeMin: 109,
    releaseDate: '2026-10-23',
    languages: ['English', 'Hindi'],
    genres: ['Horror', 'Thriller', 'Science Fiction'],
    certificate: null,
    trailerKey: null,
    status: 'upcoming',
    cast: [
      { name: 'Tom Rhys Harries', character: 'Matt Hagen / Clayface', profilePath: '/elxvpHPqOxGcKe6U2hcArIcpyWo.jpg' },
      { name: 'Naomi Ackie', character: 'Caitlyn Corr', profilePath: '/dijwuTAEZUzQtoJfK49S4X80fQw.jpg' },
      { name: 'Eddie Marsan', character: null, profilePath: '/9atfOgIxhfOKvv2be8HEp6SzOct.jpg' },
      { name: 'Max Minghella', character: 'John Borrelli', profilePath: '/AhVDxsOOoAnwwVBL7ZY8W0mGsYJ.jpg' },
    ],
  },
  {
    tmdbId: 1626806,
    title: 'Seyon',
    overview: null,
    posterPath: '/kF7zByEOT2zwrmIyfpxcn5byowY.jpg',
    backdropPath: '/mMB3hT8i8bJNbP3ojWauAYuWWeX.jpg',
    runtimeMin: null,
    releaseDate: '2026-10-26',
    languages: ['Tamil'],
    genres: ['Fantasy', 'Drama'],
    certificate: null,
    trailerKey: null,
    status: 'upcoming',
    cast: [
      { name: 'Sivakarthikeyan', character: null, profilePath: '/jgy9y3V8QqZmu5r8sMxrGCzXuyp.jpg' },
      { name: 'Bhagyashree Borse', character: null, profilePath: '/3gVgbXl0YC1xxrFatf0pEkFbK4Q.jpg' },
      { name: 'Raj B Shetty', character: null, profilePath: '/vlNvrGhaYzmRxhkd4GOKFNfSkHY.jpg' },
      { name: 'Seeman', character: null, profilePath: '/AvWr2G6v0OZ3DL3cGF7PbWojag2.jpg' },
    ],
  },
  {
    tmdbId: 1503762,
    title: 'Sense and Sensibility',
    overview:
      'A warm, witty new take on Jane Austen’s story of the Dashwood sisters, love and sisterhood.',
    posterPath: '/czsyPHosFNbh4PPqXfqWu1aBXnA.jpg',
    backdropPath: '/nkINWVL8x1KwdpO0dUbYhS3Y1iP.jpg',
    runtimeMin: 132,
    releaseDate: '2026-10-30',
    languages: ['English'],
    genres: ['Drama', 'Romance'],
    certificate: null,
    trailerKey: null,
    status: 'upcoming',
    cast: [
      { name: 'Daisy Edgar-Jones', character: 'Elinor Dashwood', profilePath: '/4Fdc3VSoVhkkEZNx5Zpz3AU6DYz.jpg' },
      { name: 'Esmé Creed-Miles', character: 'Marianne Dashwood', profilePath: '/hmGkEC4OWsyDe7ZGVkZ7e1RjViD.jpg' },
      { name: 'Caitríona Balfe', character: 'Mrs. Dashwood', profilePath: '/lerCNTjO6FQIam2lF5SXHA4dY7H.jpg' },
      { name: 'Fiona Shaw', character: 'Mrs. Jennings', profilePath: '/8X7fZybxtwh2nTvYk6kjRYo9RIY.jpg' },
      { name: 'George MacKay', character: 'Edward Ferrars', profilePath: '/wnDAg1CyCbBCklQAZ9I1dj5X6QY.jpg' },
    ],
  },
];
