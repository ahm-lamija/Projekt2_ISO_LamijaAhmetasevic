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

// --- KONFIGURACIJA BAZE (SADA PREKO process.env) ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'projekat2_db',
    port: parseInt(process.env.DB_PORT) || 3306
};

let db;

function connectToDB(attemptNumber = 1) {
    const maxAttempts = 10;
    const baseDelay = 1500;

    // Provjera da li su unijete ključne varijable
    if (!dbConfig.host || !dbConfig.password) {
        logger.error('KRITIČNA GREŠKA: Nedostaju mrežne varijable DB_HOST ili DB_PASSWORD unutar Docker okruženja!');
        process.exit(1);
    }

    db = mysql.createConnection(dbConfig);

    db.connect(err => {
        if (err) {
            if (attemptNumber <= maxAttempts) {
                const delay = baseDelay * Math.pow(2, attemptNumber - 1);
                logger.warn(`Pokušaj ${attemptNumber}/${maxAttempts}: Baza nije spremna. Re-connect za ${delay}ms... Greška: ${err.message}`);
                setTimeout(() => connectToDB(attemptNumber + 1), delay);
            } else {
                logger.error('KRITIČNA GREŠKA: Nije moguće spojiti se na bazu nakon maksimalnog broja pokušaja.');
                process.exit(1);
            }
            return;
        }
        logger.info('Uspješno povezano na AWS MySQL bazu.');

        // --- AUTOMATSKO KREIRANJE TABELE I UBACIVANJE PODATAKA ---
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS proizvodi (
                id INT AUTO_INCREMENT PRIMARY KEY,
                naziv VARCHAR(255) NOT NULL,
                kolicina INT DEFAULT 0
            );
        `;
        db.query(createTableSQL, (err) => {
            if (err) {
                logger.error('Greška pri kreiranju tabele: ' + err.message);
            } else {
                logger.info('Tabela "proizvodi" je spremna.');
                
                // Provjeravamo da li već ima podataka, da ne ubacujemo duplikate svaki put
                db.query('SELECT COUNT(*) AS count FROM proizvodi', (err, rows) => {
                    if (!err && rows[0].count === 0) {
                        const insertSQL = `INSERT INTO proizvodi (naziv, kolicina) VALUES ('Laptop', 10), ('Monitor', 5);`;
                        db.query(insertSQL, () => logger.info('Početni podaci (Laptop, Monitor) ubačeni u AWS bazu!'));
                    }
                });
            }
        });

        // --- AUTOMATSKO POSTAVLJANJE UNIQUE KLJUČA ---
        const setupSQL = "ALTER TABLE proizvodi ADD UNIQUE (naziv);";
        db.query(setupSQL, (setupErr) => {
            if (setupErr) {
                if (setupErr.errno === 1061) {
                    logger.info('Pravilo za unikatni naziv već postoji. Baza je spremna.');
                } else {
                    logger.warn('Napomena: Baza ima duplikate, pa nije mogla postaviti unikatno pravilo.');
                }
            } else {
                logger.info('Baza je automatski konfigurisana (Unique pravilo postavljeno).');
            }
        });

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

// POST: Dodavanje i sabiranje količine ako artikal postoji
app.post('/api/proizvodi', (req, res) => {
    const { naziv, kolicina } = req.body;
    const kol = parseInt(kolicina);

    if (!naziv || isNaN(kol)) { 
        return res.status(400).json({error: 'Naziv i količina su obavezni'}); 
    }

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`Backend servis pokrenut na portu ${PORT}`));

process.on('SIGTERM', () => {
    db.end(() => process.exit(0));
});