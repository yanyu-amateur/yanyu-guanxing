#!/usr/bin/env node
/**
 * 烟雨江湖 · 明文存档加密打包器（.yanyu）
 * =========================================
 * 用途：把导出引擎拿到的明文存档 JSON 打包成加密 .yanyu，明文不再落盘。
 *
 * 容器格式（magic = YANYUPL1）：
 *   [0 ..7]   magic   "YANYUPL1"                 8 bytes
 *   [8]       version 1 = 仅固定口令；2 = 固定口令 + 授权码
 *   [9]       flags   bit0 = gzip 压缩
 *   [10..25]  salt    16 bytes（随机）
 *   [26..37]  nonce   12 bytes（随机，AES-GCM IV）
 *   [38..45]  codeTag  8 bytes（仅 v2：授权码指纹，用于溯源；不是授权码本身）
 *   [...]     AES-256-GCM( gzip(json) ) || tag(16)
 *
 * 密钥：
 *   v1: PBKDF2-SHA256(SECRET, salt, 120000, 32)
 *   v2: PBKDF2-SHA256(SECRET + '\0' + 授权码, salt, 120000, 32)
 *   → v2 的文件，没有对应授权码的人即使拿到工具也解不开
 *
 * 用法：
 *   node yanyu-pack.js <明文.json> <输出.yanyu> [授权码]        打包（给了码 = v2）
 *   node yanyu-pack.js --unpack <输入.yanyu> <输出.json> [授权码]  解包（作者自查）
 *
 * 注意：SECRET 必须与 bin/web/shared/save_decrypt.js 里的
 *      SAVE_PLAIN_YANYU_SECRET 完全一致；改掉会让旧文件无法打开。
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const MAGIC = 'YANYUPL1';
const VERSION_PLAIN = 1;
const VERSION_CODE = 2;
const FLAG_GZIP = 1;
const SECRET = 'yanyu-plain-export-v1|7f3c1d9a4e6b2085';
const KDF_ITERATIONS = 120000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CODE_TAG_BYTES = 8;

function deriveKey(salt, code) {
    const material = code ? (SECRET + '\u0000' + code) : SECRET;
    return crypto.pbkdf2Sync(Buffer.from(material, 'utf8'), salt, KDF_ITERATIONS, 32, 'sha256');
}

/** 授权码指纹：只用来溯源，无法反推出授权码。 */
function codeTag(code) {
    return crypto.createHash('sha256')
        .update('yanyu-code-tag|' + code, 'utf8')
        .digest()
        .slice(0, CODE_TAG_BYTES);
}

function headerBytes(version) {
    return MAGIC.length + 2 + SALT_BYTES + NONCE_BYTES
        + (version === VERSION_CODE ? CODE_TAG_BYTES : 0);
}

function packFile(inputPath, outputPath, code) {
    const plain = fs.readFileSync(inputPath);
    if (!plain.length) throw new Error('输入文件为空：' + inputPath);
    code = code ? String(code).trim() : '';
    const version = code ? VERSION_CODE : VERSION_PLAIN;

    const gz = zlib.gzipSync(plain, { level: 9 });
    const salt = crypto.randomBytes(SALT_BYTES);
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(salt, code), nonce);
    const body = Buffer.concat([cipher.update(gz), cipher.final(), cipher.getAuthTag()]);

    const parts = [
        Buffer.from(MAGIC, 'ascii'),
        Buffer.from([version, FLAG_GZIP]),
        salt,
        nonce
    ];
    if (version === VERSION_CODE) parts.push(codeTag(code));
    const head = Buffer.concat(parts);

    fs.writeFileSync(outputPath, Buffer.concat([head, body]));
    return {
        ok: true,
        mode: 'pack',
        version: version,
        plain: plain.length,
        gzip: gz.length,
        packed: head.length + body.length,
        codeTag: version === VERSION_CODE ? codeTag(code).toString('hex') : null
    };
}

function unpackBuffer(buf, code) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    if (buf.length < MAGIC.length + 2 + SALT_BYTES + NONCE_BYTES + TAG_BYTES + 1) {
        throw new Error('文件太短，不是有效的 .yanyu');
    }
    if (buf.slice(0, MAGIC.length).toString('ascii') !== MAGIC) {
        throw new Error('文件头不匹配，不是本工具导出的 .yanyu');
    }
    const version = buf[MAGIC.length];
    if (version !== VERSION_PLAIN && version !== VERSION_CODE) {
        throw new Error('不支持的 .yanyu 版本：' + version);
    }
    const flags = buf[MAGIC.length + 1];
    code = code ? String(code).trim() : '';
    if (version === VERSION_CODE && !code) {
        throw new Error('这张 .yanyu 需要用授权码才能解开（请提供导出时用的授权码）');
    }

    const saltStart = MAGIC.length + 2;
    const nonceStart = saltStart + SALT_BYTES;
    const afterNonce = nonceStart + NONCE_BYTES;
    const bodyStart = afterNonce + (version === VERSION_CODE ? CODE_TAG_BYTES : 0);
    const salt = buf.slice(saltStart, nonceStart);
    const nonce = buf.slice(nonceStart, afterNonce);
    const body = buf.slice(bodyStart);
    const tag = body.slice(body.length - TAG_BYTES);
    const data = body.slice(0, body.length - TAG_BYTES);

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm', deriveKey(salt, version === VERSION_CODE ? code : ''), nonce);
    decipher.setAuthTag(tag);
    let out = Buffer.concat([decipher.update(data), decipher.final()]);
    if (flags & FLAG_GZIP) out = zlib.gunzipSync(out);
    return out;
}

function unpackFile(inputPath, outputPath, code) {
    const out = unpackBuffer(fs.readFileSync(inputPath), code);
    fs.writeFileSync(outputPath, out);
    return { ok: true, mode: 'unpack', packed: fs.statSync(inputPath).size, plain: out.length };
}

function main() {
    const argv = process.argv.slice(2);
    try {
        if (argv[0] === '--unpack') {
            if (argv.length < 3) {
                throw new Error('用法：node yanyu-pack.js --unpack <输入.yanyu> <输出.json> [授权码]');
            }
            console.log(JSON.stringify(unpackFile(argv[1], argv[2], argv[3] || '')));
            return;
        }
        if (argv.length < 2) {
            throw new Error('用法：node yanyu-pack.js <明文.json> <输出.yanyu> [授权码]');
        }
        console.log(JSON.stringify(packFile(argv[0], argv[1], argv[2] || '')));
    } catch (e) {
        console.error('yanyu-pack: ' + (e && e.message ? e.message : e));
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = {
    packFile, unpackFile, unpackBuffer, codeTag,
    MAGIC, VERSION_PLAIN, VERSION_CODE, SECRET
};
