import { Env } from "..";

export async function updateKeyValue(env: Env) {
  await cron_asura(env);
  return new Response(null, {
    status: 200,
    statusText: "Successfully changed DB Store",
  });
}

const cron_asura = async (c: Env) => {
  try {
    const response = await fetch('https://asuracomic.net/series');
    if (!response.ok) {
      console.error("Failed to fetch AsuraScans");
      return;
    }

    let start_reading = false;
    let read_next = false;
    let read_chapter: boolean = false;
    let manhwachapter: string[] = [];
    let manhwaTitle: string[] = [];
    let manhwaData: { title: string; chapter: string; }[] = []; // Array to store extracted manhwa names and chapters

    const rewriter = new HTMLRewriter()
      .on('span', {
        text(text) {
          const trimmedText = text.text.trim();
          
          if (trimmedText) {
            if (trimmedText.toLowerCase().includes('search')) {
              start_reading = true; // Start reading when 'search' is found
            }
            if (start_reading) {
              if (read_next) {
                manhwaTitle.push(trimmedText);
                read_next = false;
              }
              if (read_chapter) {
                manhwachapter.push(trimmedText);
                read_chapter = false;
              }
              // Check if the text contains manhwa title information
              if (trimmedText.toLowerCase().includes('manhwa') || trimmedText.toLowerCase().includes('manga') || trimmedText.toLowerCase().includes('manhua')) {
                read_next = true;
              }
              if (trimmedText.toLowerCase().includes('chapter') || trimmedText.toLowerCase().includes('pter')) {
                read_chapter = true;
              }
            }
          }
        },
      });

    await rewriter.transform(response).arrayBuffer(); // Process HTML

    // Insert data into D1 (Cloudflare's SQL database)
    for (let i = 0; i < manhwaTitle.length; i++) {
      const title = manhwaTitle[i];
      const chapter = manhwachapter[i];

      // Check if the manhwa already exists in the database
      const existingRecord = await c.DB.prepare(`
        SELECT id FROM manhwas WHERE website_title = ? AND website = 'https://asuracomic.net'
      `).bind(title).first();

      if (existingRecord) {
        // If it exists, update the chapters
        await c.DB.prepare(`
          UPDATE manhwas SET chapters = ? WHERE id = ?
        `).bind(chapter, existingRecord.id).run();
      } else {
      // Insert the data into D1 database
      await c.DB.prepare(`
        INSERT INTO manhwas (title, website_title, website, alt_title, type, volumes, chapters, status, 
          published_start, published_end, genres, themes, serialization, authors, members, favorites, 
          synopsis, background) 
        VALUES ('', ?, 'https://asuracomic.net', '', '', 0, ?, '', '', '', '', '', '', 0, 0, '', '','')
      `)
      .bind(title, chapter)
      .run();
      }
      manhwaData.push({ title, chapter });
    }
    console.log("Scraping completed");
    console.log(manhwaData);
    return;

  } catch (error) {
    console.error("Scraping error:", error);
    return;
  }
};
