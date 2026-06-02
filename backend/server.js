const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// --- KONFIGURACIJA LOGERA ---
const logDir = 'logs';
if (!fs.existsSync(logDir)) { fs.mkdirSync(logDir); }

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: path.join(logDir, 'app.log') })
    ],
});

// --- KONFIGURACIJA BAZE ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'inventar_db'
};

let db;

function connectToDB(attemptNumber = 1) {
    const maxAttempts = 10;
    const baseDelay = 1500;

    db = mysql.createConnection(dbConfig);

    db.connect(err => {
        if (err) {
            if (attemptNumber <= maxAttempts) {
                const delay = baseDelay * Math.pow(2, attemptNumber - 1);
                logger.warn(`Pokušaj ${attemptNumber}/${maxAttempts}: Baza nije spremna. Re-connect za ${delay}ms...`);
                setTimeout(() => connectToDB(attemptNumber + 1), delay);
            } else {
                logger.error('KRITIČNA GREŠKA: Nije moguće spojiti se na bazu.');
                process.exit(1);
            }
            return;
        }
        logger.info('Uspješno povezano na MySQL bazu.');

        // --- DODANO: AUTOMATSKO POSTAVLJANJE UNIQUE KLJUČA ---
        const setupSQL = "ALTER TABLE proizvodi ADD UNIQUE (naziv);";
        db.query(setupSQL, (setupErr) => {
            if (setupErr) {
                // 1061 = Duplicate key name (ključ već postoji, što znači da je sve ok)
                if (setupErr.errno === 1061) {
                    logger.info('Pravilo za unikatni naziv već postoji. Baza je spremna.');
                } else {
                    logger.warn('Napomena: Baza ima duplikate, pa nije mogla postaviti unikatno pravilo. Prvo obriši duplikate iz tabele!');
                }
            } else {
                logger.info('Baza je automatski konfigurisana (Unique pravilo postavljeno).');
            }
        });
        // -----------------------------------------------------

        db.on('error', (err) => {
            logger.error(`Greška baze (${err.code}). Reconnecting...`);
            if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
                connectToDB();
            }
        });
    });
}

connectToDB();

// --- API RUTE ---

// GET: Svi proizvodi
app.get('/api/proizvodi', (req, res) => {
    db.query('SELECT * FROM proizvodi ORDER BY naziv ASC', (err, results) => {
        if (err) { 
            logger.error('Greška pri dohvaćanju: ' + err.message); 
            return res.status(500).json({error: 'Greška na serveru'}); 
        }
        res.json(results);
    });
});

// POST: DODAVANJE (Ovdje je bila greška - SADA JE ISPRAVLJENO)
app.post('/api/proizvodi', (req, res) => {
    const { naziv, kolicina } = req.body;
    const kol = parseInt(kolicina);

    if (!naziv || isNaN(kol)) { 
        return res.status(400).json({error: 'Naziv i količina su obavezni'}); 
    }

    // Ova logika sprečava duplikate i sabira kolicinu:
    const sql = `
        INSERT INTO proizvodi (naziv, kolicina) 
        VALUES (?, ?) 
        ON DUPLICATE KEY UPDATE kolicina = kolicina + ?
    `;

    db.query(sql, [naziv, kol, kol], (err, result) => {
        if (err) { 
            logger.error('SQL Greška: ' + err.message); 
            return res.status(500).json({error: err.message}); 
        }
        logger.info(`Obrada artikla: ${naziv} (+${kol})`);
        res.json({message: 'Uspješno ažurirano'});
    });
});

// PATCH: Prilagodi količinu (+1 ili -1)
app.patch('/api/proizvodi/:id/prilagodi', (req, res) => {
    const { id } = req.params;
    const { promjena } = req.body; 
    db.query('UPDATE proizvodi SET kolicina = GREATEST(0, kolicina + ?) WHERE id = ?', [promjena, id], (err, result) => {
        if (err) { logger.error(err.message); return res.status(500).json({error: err.message}); }
        res.json({message: 'Količina ažurirana'});
    });
});

// DELETE: Obriši proizvod
app.delete('/api/proizvodi/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM proizvodi WHERE id = ?', [id], (err, result) => {
        if (err) { logger.error(err.message); return res.status(500).json({error: err.message}); }
        res.json({message: 'Proizvod obrisan'});
    });
});

const PORT = 5000;
app.listen(PORT, () => logger.info(`Backend servis pokrenut na portu ${PORT}`));

process.on('SIGTERM', () => {
    db.end(() => process.exit(0));
});