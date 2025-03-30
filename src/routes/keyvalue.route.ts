import { Env } from "..";
import { createClient } from '@supabase/supabase-js';

export async function updateKeyValue(env: Env) {
  await cron_asura(env);
  return new Response(null, {
    status: 200,
    statusText: "Successfully updated Supabase",
  });
}

const cron_asura = async (c: Env) => {
  try {
    // Initialize Supabase client
    const supabaseUrl = c.SUPABASE_URL;
    const supabaseKey = c.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const response = await fetch('https://asuracomic.net/series');
    if (!response.ok) {
      console.error("Failed to fetch AsuraScans");
      return;
    }

    let start_reading = false;
    let read_next = false;
    let read_chapter = false;
    let manhwachapter: string[] = [];
    let manhwaTitle: string[] = [];
    let manhwaData: { title: string; chapter: string }[] = [];

    const rewriter = new HTMLRewriter()
      .on('span', {
        text(text) {
          const trimmedText = text.text.trim();
          
          if (trimmedText) {
            if (trimmedText.toLowerCase().includes('search')) {
              start_reading = true;
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

    await rewriter.transform(response).arrayBuffer();

    if (manhwaTitle.length === 0) {
      console.log("No data found.");
      return;
    }

    // Get all existing records from Supabase
    const { data: existingRecords, error: fetchError } = await supabase
      .from('manhwas')
      .select('id, website_title, chapters')
      .in('website_title', manhwaTitle)
      .eq('website', 'https://asuracomic.net');

    if (fetchError) {
      console.error("Error fetching records:", fetchError);
      return;
    }

    // Create a map for faster lookups
    const existingMap = new Map(
      existingRecords?.map(record => [record.website_title, { id: record.id, chapters: record.chapters }]) || []
    );

    // Prepare batches for operations
    const updates = [];
    const inserts = [];

    for (let i = 0; i < manhwaTitle.length; i++) {
      const title = manhwaTitle[i];
      const chapter = manhwachapter[i] ?? "";

      if (existingMap.has(title)) {
        const existingRecord = existingMap.get(title);
        if (existingRecord && existingRecord.chapters !== chapter) {
          // Only update if chapter has changed
          updates.push({ 
            id: existingRecord.id,
            chapters: chapter 
          });
        }
      } else {
        // Insert new manhwa
        inserts.push({
          title: '',
          website_title: title,
          website: 'https://asuracomic.net',
          alt_title: '',
          type: '',
          volumes: 0,
          chapters: chapter,
          status: '',
          published_start: null,
          published_end: null,
          genres: '',
          themes: '',
          serialization: '',
          authors: '',
          members: 0,
          favorites: 0,
          synopsis: '',
          background: ''
        });
      }
      
      manhwaData.push({ title, chapter });
    }

    // Execute updates
    if (updates.length > 0) {
      // Supabase doesn't support batch updates directly, so we need to do them one by one
      // But we can use Promise.all to parallelize them
      await Promise.all(updates.map(update => 
        supabase.from('manhwas').update({ chapters: update.chapters }).eq('id', update.id)
      ));
    }

    // Execute inserts (can be done in a single batch)
    if (inserts.length > 0) {
      const { error: insertError } = await supabase.from('manhwas').insert(inserts);
      if (insertError) {
        console.error("Error inserting records:", insertError);
      }
    }

    console.log("Scraping completed");
    console.log(manhwaData);
    return;
  } catch (error) {
    console.error("Scraping error:", error);
    return;
  }
};
