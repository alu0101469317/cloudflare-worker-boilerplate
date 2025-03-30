import { Env } from "..";
import { createClient } from '@supabase/supabase-js';

export async function scrapeAsuraScans(env: Env): Promise<Response> {
  try {
    console.log("======= INICIANDO SCRAPE DE ASURASCAN =======");
    const result = await scrapeAndUpdateDatabase(env);
    console.log("======= SCRAPE COMPLETADO =======");
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("⚠️ ERROR AL EJECUTAR SCRAPING:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

// Función para decodificar entidades HTML
function decodeHTMLEntities(text: string): string {
  const textarea = new TextDecoder();
  const buffer = new TextEncoder().encode(text);
  
  let decoded = textarea.decode(buffer)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      return String.fromCharCode(dec);
    });
  
  return decoded;
}

// Función para normalizar texto para comparación
function normalizeText(text: string): string {
  return decodeHTMLEntities(text)
    .toLowerCase()
    .normalize("NFD") // Descompone caracteres acentuados
    .replace(/[\u0300-\u036f]/g, "") // Elimina diacríticos
    .replace(/[^\w\s]/g, "") // Elimina puntuación
    .replace(/\s+/g, " ") // Normaliza espacios
    .trim();
}

// Añade esta función helper al principio del archivo
function extractChapterNumber(chapterString: string): number {
  const match = chapterString?.match(/Chapter\s*(?:<!--\s*-->)*\s*([0-9.]+)/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return 0; // Valor predeterminado si no se encuentra
}

// Añade esta función auxiliar después de extractChapterNumber
function formatManhwaUrl(baseUrl: string, chapter: string): string {
  // Extraer el número de capítulo
  const chapterNum = extractChapterNumber(chapter);
  
  // Asegurarse de que la URL no termine con barra
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  
  // Añadir /chapter/número al final
  return `${cleanBaseUrl}/chapter/${chapterNum}`;
}

async function scrapeAndUpdateDatabase(env: Env) {
  try {
    console.log("🔍 Iniciando scraping de AsuraScans...");
    
    // Initialize Supabase client
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    
    // Test Supabase connection
    try {
      // Forma correcta de contar registros en Supabase
      const { count, error: testError } = await supabase
        .from('manhwas')
        .select('*', { count: 'exact', head: true });
        
      if (testError) {
        console.error("⚠️ Error al probar conexión Supabase:", testError.message);
      }
    } catch (testErr) {
      console.error("⚠️ Error inesperado al probar Supabase:", testErr);
    }
    
    // Fetch the AsuraScans website
    const response = await fetch('https://asuracomic.net/series', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch AsuraScans: ${response.status}`);
    }

    // Estructura de datos más completa
    interface ManhwaData {
      title: string;
      normalizedtitle: string;
      chapter: string;
      url: string;
      originalTitle: string;
      status?: string;
      type?: string;
    }

    let manhwaItems: ManhwaData[] = [];
    let currentManhwa: Partial<ManhwaData> = {};
    let captureCount = 0;
    let titleCount = 0;
    let chapterCount = 0;

    // Antes del bloque del HTMLRewriter
    let tempRawChapterText = '';
    let tempTitleText = ''; 
    
    const rewriter = new HTMLRewriter()
      .on('a[href^="series/"]', {
        element(element) {
          captureCount++;
          currentManhwa = {
            url: `https://asuracomic.net/${element.getAttribute('href')}`,
            originalTitle: '',
            title: '',
            normalizedtitle: '',
            chapter: '',
            status: '',
            type: 'MANHWA'
          };
        }
      })
      .on('a[href^="series/"] span.block', {
        text(text) {
          if (currentManhwa.url) {
            // Acumular el texto en lugar de reemplazarlo
            tempTitleText += text.text;
            
            // Solo procesar cuando tenemos el nodo de texto completo
            if (text.lastInTextNode && tempTitleText.trim()) {
              titleCount++;
              currentManhwa.originalTitle = tempTitleText.trim();
              currentManhwa.title = decodeHTMLEntities(currentManhwa.originalTitle);
              currentManhwa.normalizedtitle = normalizeText(currentManhwa.originalTitle);
              
              // Limpiar para el siguiente título
              tempTitleText = '';
            }
          }
        }
      })
      .on('span.text-\\[13px\\]', {
        text(text) {
          // Siempre acumulamos el texto, sin importar su contenido
          if (currentManhwa.url) {
            tempRawChapterText += text.text;
            
            // Si hemos acumulado suficiente texto que contenga el patrón completo
            if (tempRawChapterText.includes("Chapter") && /\d+/.test(tempRawChapterText)) {
              // Ya tenemos suficiente texto para procesar (contiene "Chapter" y al menos un número)
              const fullText = tempRawChapterText.trim();
              
              // Extraer el número del capítulo
              const chapterRegex = /Chapter\s*(?:<!--\s*-->)*\s*([0-9.]+)/i;
              const chapterMatch = fullText.match(chapterRegex);
              
              if (chapterMatch) {
                chapterCount++;
                currentManhwa.chapter = `Chapter ${chapterMatch[1]}`;
                
                // Si tenemos suficiente información, guardamos el item
                if (currentManhwa.title && currentManhwa.url) {
                  // Actualizar la URL para incluir el capítulo
                  currentManhwa.url = formatManhwaUrl(currentManhwa.url, currentManhwa.chapter);
                  
                  manhwaItems.push({...currentManhwa} as ManhwaData);
                  
                  // Reiniciar para el siguiente item
                  currentManhwa = {};
                  tempRawChapterText = '';
                }
              }
            }
            
            // Si llegamos al final del nodo y no hemos procesado nada, limpiamos
            if (text.lastInTextNode && !tempRawChapterText.includes("Chapter")) {
              tempRawChapterText = '';
            }
          }
        }
      })
      .on('span.status', {
        text(text) {
          if (currentManhwa.url) {
            currentManhwa.status = text.text.trim();
          }
        }
      });
    
    await rewriter.transform(response).arrayBuffer();

    // Si no hay resultados, probemos un método muy básico
    if (manhwaItems.length === 0) {
      // Recuperar el HTML para análisis de emergencia
      const htmlResponse = await fetch('https://asuracomic.net/series', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      const htmlContent = await htmlResponse.text();
      
      // Buscar cualquier coincidencia de título y capítulo
      const titleRegex = /<span[^>]*>([^<]+)<\/span>[\s\S]*?Chapter\s+(\d+)/g;
      let basicMatch;
      while ((basicMatch = titleRegex.exec(htmlContent)) !== null) {
        captureCount++;
        const title = basicMatch[1].trim();
        const chapter = `Chapter ${basicMatch[2].trim()}`;
        
        const item: ManhwaData = {
          title: decodeHTMLEntities(title),
          normalizedtitle: normalizeText(title),
          chapter: chapter,
          url: formatManhwaUrl(
            `https://asuracomic.net/series/${title.toLowerCase().replace(/\s+/g, '-')}`, 
            chapter
          ),
          originalTitle: title
        };
        
        manhwaItems.push(item);
      }
    }

    // Obtener registros existentes
    const { data: existingRecords, error: fetchError } = await supabase
      .from('manhwas')
      .select('id, title, website_title, chapters, url');

    if (fetchError) {
      console.error("⚠️ Error al obtener registros:", fetchError);
      throw new Error(`Error fetching records: ${fetchError.message}`);
    }

    // Crear mapa para búsqueda eficiente (usando títulos normalizados)
    const existingMap = new Map();
    (existingRecords || []).forEach(record => {
      try {
        const normalizedtitle = normalizeText(record.website_title);
        existingMap.set(normalizedtitle, record);
        
        // También guardar versiones parciales para mejor coincidencia
        if (normalizedtitle.length > 10) {
          existingMap.set(normalizedtitle.substring(0, normalizedtitle.length - 3), record);
        }
      } catch (error) {
        console.error(`⚠️ Error normalizando título para registro ${record.id}:`, error);
      }
    });

    // Preparar operaciones
    const updates = [];
    const inserts = [];
    const noChanges = [];

    for (const item of manhwaItems) {
      try {
        // Buscar por título normalizado o coincidencia parcial
        const existingRecord = findBestMatch(item.normalizedtitle, existingMap);
        
        if (existingRecord) {
          // Extraer solo los números de capítulo para comparación
          const existingChapterNum = extractChapterNumber(existingRecord.chapters);
          const newChapterNum = extractChapterNumber(item.chapter);
          
          // Comprobar si realmente hay un cambio en el número o en la URL
          if (existingChapterNum !== newChapterNum || existingRecord.url !== item.url) {
            updates.push({
              id: existingRecord.id,
              oldChapter: existingRecord.chapters,
              newChapter: item.chapter,
              title: existingRecord.website_title,
              newUrl: item.url // Añadir la nueva URL
            });
          } else {
            noChanges.push({
              id: existingRecord.id,
              title: existingRecord.website_title
            });
          }
        } else {
          // Insertar nuevo
          inserts.push({
            title: item.title,
            website_title: item.title,
            normalizedtitle: item.normalizedtitle,
            website: 'https://asuracomic.net',
            chapters: item.chapter,
            url: item.url,
            updated_at: new Date().toISOString()
          });
        }
      } catch (matchError) {
        console.error(`⚠️ Error procesando coincidencia para "${item.title}":`, matchError);
      }
    }

    console.log(`📊 Resumen: ${updates.length} actualizaciones, ${inserts.length} inserciones, ${noChanges.length} sin cambios`);


    // Procesar actualizaciones
    let updateCount = 0;
    
    if (updates.length > 0) {
      console.log("\n🔄 Procesando actualizaciones...");
      
      for (const update of updates) {
        try {
          const { error } = await supabase
            .from('manhwas')
            .update({
              chapters: update.newChapter,
              url: update.newUrl, // Añadir la URL a la actualización
              updated_at: new Date().toISOString()
            })
            .eq('id', update.id);
          
          if (!error) {
            updateCount++;
            // Mostrar detalles de cada actualización
            console.log(`  🔄 Actualizado: "${update.title}" - ${update.oldChapter} → ${update.newChapter}`);
          } else {
            console.error(`  ⚠️ Error actualizando "${update.title}":`, error.message);
          }
        } catch (updateError) {
          console.error(`  ⚠️ Excepción actualizando registro ${update.id}:`, updateError);
        }
      }
      
      console.log(`✅ Actualizaciones completadas: ${updateCount}/${updates.length}`);
    }

    // Procesar inserciones de forma segura (lote por lote)
    let insertCount = 0;
    const BATCH_SIZE = 10; // Reducimos para mayor seguridad
    
    if (inserts.length > 0) {
      console.log("\n➕ Procesando inserciones...");
      
      for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
        try {
          const batch = inserts.slice(i, i + BATCH_SIZE);
          console.log(`  Insertando lote ${i/BATCH_SIZE + 1}/${Math.ceil(inserts.length/BATCH_SIZE)} (${batch.length} items)`);
                    
          const { data, error } = await supabase
            .from('manhwas')
            .insert(batch)
            .select();
          
          if (error) {
            console.error(`  ⚠️ Error insertando lote:`, error.message);
            
            // Intenta insertar uno a uno si falla el lote
            console.log("  Intentando inserción individual...");
            for (const item of batch) {
              try {
                const { error: singleError } = await supabase
                  .from('manhwas')
                  .insert(item)
                  .select();
                
                if (!singleError) {
                  insertCount++;
                  console.log(`  ➕ Insertado: "${item.website_title}" - ${item.chapters}`);
                } else {
                  console.error(`  ⚠️ Error insertando "${item.website_title}":`, singleError.message);
                }
              } catch (singleError) {
                console.error(`  ⚠️ Excepción insertando "${item.website_title}":`, singleError);
              }
            }
          } else {
            const newCount = data?.length || 0;
            insertCount += newCount;
            
            // Mostrar cada item insertado en el lote
            data?.forEach(item => {
              console.log(`  ➕ Insertado: "${item.website_title}" - ${item.chapters}`);
            });
          }
        } catch (batchError) {
          console.error(`  ⚠️ Excepción procesando lote ${i/BATCH_SIZE + 1}:`, batchError);
        }
      }
      
      console.log(`✅ Inserciones completadas: ${insertCount}/${inserts.length}`);
    }

    console.log("\n✅ PROCESO COMPLETADO");
    return {
      message: "Scraping completed successfully",
      total: manhwaItems.length,
      inserted: insertCount,
      updated: updateCount,
      noChanges: noChanges.length,
      timeStamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("⚠️ ERROR GENERAL:", error);
    throw error;
  }
}

// Reemplaza completamente la función findBestMatch
function findBestMatch(normalizedtitle: string, existingMap: Map<string, any>): any {
  // 1. Intentar coincidencia exacta (prioridad máxima)
  if (existingMap.has(normalizedtitle)) {
    return existingMap.get(normalizedtitle);
  }
  
  // Preparar un array para posibles coincidencias con puntaje
  const candidates: {record: any, score: number, debugInfo?: string}[] = [];
  
  // 2. Buscar coincidencias parciales con diferentes estrategias
  for (const [key, value] of existingMap.entries()) {
    // Evitar procesar entradas demasiado cortas que podrían causar falsos positivos
    if (key.length < 5) continue;
    
    // 2.1 Coincidencia de prefijo exacto (inicio del título)
    if (normalizedtitle.startsWith(key) || key.startsWith(normalizedtitle)) {
      // Solo si una es claramente una versión más larga de la otra
      if (Math.abs(key.length - normalizedtitle.length) < 5 || 
          (normalizedtitle.includes(key) || key.includes(normalizedtitle))) {
        const prefixScore = Math.min(key.length, normalizedtitle.length) * 2;
        candidates.push({
          record: value, 
          score: prefixScore,
          debugInfo: `Prefijo exacto: ${key}`
        });
        continue;
      }
    }
    
    // 2.2 Coincidencia de palabras claves (para títulos de varias palabras)
    const words1 = normalizedtitle.split(' ');
    const words2 = key.split(' ');
    
    // Si comparten al menos 2 palabras importantes (que no sean "the", "of", etc.)
    const importantWords1 = words1.filter(w => w.length > 2 && !['the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a'].includes(w));
    const importantWords2 = words2.filter(w => w.length > 2 && !['the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a'].includes(w));
    
    // Calculamos palabras compartidas y únicas de cada título
    const sharedWords = importantWords1.filter(w => importantWords2.includes(w));
    const uniqueWords1 = importantWords1.filter(w => !importantWords2.includes(w));
    const uniqueWords2 = importantWords2.filter(w => !importantWords1.includes(w));
    
    // Añadimos penalización si hay demasiadas palabras únicas
    const totalUniqueWords = uniqueWords1.length + uniqueWords2.length;
    
    // Si comparten al menos 3 palabras significativas Y no tienen demasiadas palabras únicas
    if (sharedWords.length >= 3 && totalUniqueWords <= sharedWords.length) {
      candidates.push({
        record: value, 
        score: sharedWords.length * 10 - totalUniqueWords * 2,
        debugInfo: `Palabras compartidas: ${sharedWords.join(', ')}, únicas: ${uniqueWords1.join(', ')} | ${uniqueWords2.join(', ')}`
      });
      continue;
    }
    
    // Regla especial para títulos cortos (2-3 palabras)
    if (importantWords1.length <= 3 && importantWords2.length <= 3 && 
        sharedWords.length >= 2 && totalUniqueWords <= 1) {
      candidates.push({
        record: value, 
        score: 25 - totalUniqueWords * 5,
        debugInfo: `Título corto, palabras compartidas: ${sharedWords.join(', ')}`
      });
      continue;
    }
    
    // 2.3 Coincidencia por similitud del título completo
    // Calculamos cuántos caracteres comparten desde el inicio
    let commonPrefixLength = 0;
    while (
      commonPrefixLength < Math.min(key.length, normalizedtitle.length) &&
      key[commonPrefixLength] === normalizedtitle[commonPrefixLength]
    ) {
      commonPrefixLength++;
    }
    
    // Solo considerar prefijo común si es una proporción significativa de ambos títulos
    const prefixRatio1 = commonPrefixLength / normalizedtitle.length;
    const prefixRatio2 = commonPrefixLength / key.length;
    
    // Si comparten un prefijo muy significativo (más de 20 caracteres Y más del 70% de ambos títulos)
    if (commonPrefixLength > 20 && (prefixRatio1 > 0.7 && prefixRatio2 > 0.7)) {
      // Calculamos un puntaje basado en la longitud del prefijo común
      // Y penalizamos por la diferencia de longitud total para preferir títulos más similares
      const lengthDifference = Math.abs(key.length - normalizedtitle.length);
      const score = commonPrefixLength - (lengthDifference * 2);
      candidates.push({
        record: value, 
        score: score,
        debugInfo: `Prefijo común de ${commonPrefixLength} caracteres (${Math.round(prefixRatio1 * 100)}%)`
      });
    }
  }
  
  // 3. Seleccionar el mejor candidato (con mayor puntaje)
  if (candidates.length > 0) {
    // Establecer un umbral mínimo de puntuación para evitar coincidencias débiles
    const SCORE_THRESHOLD = 20;
    
    // Ordenar candidatos por puntaje descendente
    candidates.sort((a, b) => b.score - a.score);
    
    // Solo usar el mejor candidato si tiene un puntaje suficientemente alto
    if (candidates[0].score >= SCORE_THRESHOLD) {
      return candidates[0].record;
    }
  }
  
  // No se encontró ninguna coincidencia aceptable
  return null;
}