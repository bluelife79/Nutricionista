#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeEmail(value) {
  return String(value || '').toLowerCase().trim();
}

function validClient(client) {
  return String(client.name || '').trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(client.email));
}

function securePassword() {
  return `Rt7!${crypto.randomBytes(12).toString('base64url')}`;
}

function csvCell(value) {
  return `"${String(value == null ? '' : value).replaceAll('"', '""')}"`;
}

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

async function allAuthUsers(supabase) {
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

function authByEmail(users, email) {
  const normalized = normalizeEmail(email);
  return users.find((user) => normalizeEmail(user.email) === normalized) || null;
}

function credentialCsv(manifest) {
  const rows = [
    ['rol', 'nombre', 'email', 'contraseña_inicial', 'activa', 'estado'],
    ['admin', 'Administración RevolucionaT', manifest.admin.email, manifest.admin.password, 'sí', manifest.admin.status],
    ...manifest.clients.map((client) => [
      'clienta',
      client.name,
      client.email,
      client.password,
      'sí',
      client.status,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

async function main() {
  const clientsFile = path.resolve(argument('clients'));
  const envFile = path.resolve(argument('env'));
  const outputDir = path.resolve(argument('output-dir', '.private'));
  const expected = Number(argument('expect', '64'));
  const adminEmail = normalizeEmail(argument('admin-email', 'admin@entrenatucorazon.es'));
  const apply = flag('apply');
  const deactivateUnlisted = flag('deactivate-unlisted');

  if (!fs.existsSync(clientsFile) || !fs.existsSync(envFile)) {
    throw new Error('Debes indicar --clients y --env con archivos existentes.');
  }

  const clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8')).map((client) => ({
    name: String(client.name || '').trim(),
    email: normalizeEmail(client.email),
  }));
  const invalid = clients.filter((client) => !validClient(client));
  const uniqueEmails = new Set(clients.map((client) => client.email));
  if (invalid.length || uniqueEmails.size !== clients.length || clients.length !== expected) {
    throw new Error(
      `Lista no válida: ${clients.length} filas, ${uniqueEmails.size} emails únicos, ${invalid.length} filas inválidas; se esperaban ${expected}.`,
    );
  }

  dotenv.config({ path: envFile, quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('El archivo de entorno no contiene las claves de Supabase.');
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const manifestFile = path.join(outputDir, 'credenciales_intercambio_manifest.json');
  const csvFile = path.join(outputDir, 'CREDENCIALES_INTERCAMBIO_CLIENTAS.csv');
  let manifest;
  if (fs.existsSync(manifestFile)) {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const savedEmails = new Set(manifest.clients.map((client) => normalizeEmail(client.email)));
    if (savedEmails.size !== uniqueEmails.size ||
        [...uniqueEmails].some((email) => !savedEmails.has(email)) ||
        normalizeEmail(manifest.admin.email) !== adminEmail) {
      throw new Error('El manifiesto existente no corresponde a esta lista. No se sobrescribirá.');
    }
  } else {
    manifest = {
      generatedAt: new Date().toISOString(),
      admin: {
        email: adminEmail,
        password: securePassword(),
        status: 'pendiente',
      },
      clients: clients.map((client) => ({
        ...client,
        password: securePassword(),
        status: 'pendiente',
      })),
    };
    writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    writePrivate(csvFile, credentialCsv(manifest));
  }

  const commonDomains = new Set([
    'gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'yahoo.com',
    'yahoo.es', 'yahoo.co.uk', 'bluewin.ch',
  ]);
  const unusualDomains = [...new Set(clients
    .map((client) => client.email.split('@')[1])
    .filter((domain) => !commonDomains.has(domain)))].sort();

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    clients: clients.length,
    uniqueEmails: uniqueEmails.size,
    adminEmail,
    unusualDomains,
    credentialFile: csvFile,
  }, null, 2));
  if (!apply) return;

  let authUsers = await allAuthUsers(supabase);
  let admin = authByEmail(authUsers, manifest.admin.email);
  if (!admin) {
    const result = await supabase.auth.admin.createUser({
      email: manifest.admin.email,
      password: manifest.admin.password,
      email_confirm: true,
      user_metadata: { name: 'Administración RevolucionaT' },
      app_metadata: { role: 'admin' },
    });
    if (result.error || !result.data.user) throw result.error || new Error('No se pudo crear el administrador.');
    admin = result.data.user;
    authUsers.push(admin);
    manifest.admin.status = 'creado';
  } else {
    const result = await supabase.auth.admin.updateUserById(admin.id, {
      app_metadata: { ...(admin.app_metadata || {}), role: 'admin' },
    });
    if (result.error) throw result.error;
    manifest.admin.status = 'existente';
  }
  writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writePrivate(csvFile, credentialCsv(manifest));

  for (const client of manifest.clients) {
    let authUser = authByEmail(authUsers, client.email);
    let createdAuth = false;
    if (!authUser) {
      const result = await supabase.auth.admin.createUser({
        email: client.email,
        password: client.password,
        email_confirm: true,
        user_metadata: { name: client.name },
        app_metadata: { role: 'member', session_version: 1 },
      });
      if (result.error || !result.data.user) {
        client.status = `error-auth:${result.error?.message || 'desconocido'}`;
        writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
        writePrivate(csvFile, credentialCsv(manifest));
        throw result.error || new Error(`No se pudo crear ${client.email}`);
      }
      authUser = result.data.user;
      authUsers.push(authUser);
      createdAuth = true;
    } else if (authUser.app_metadata?.role !== 'member') {
      throw new Error(`${client.email} existe con un rol incompatible.`);
    }

    const profileResult = await supabase
      .from('users')
      .upsert({
        name: client.name,
        email: client.email,
        code: `AUTH:${authUser.id}`,
        active: true,
      }, { onConflict: 'email' })
      .select('email')
      .single();

    if (profileResult.error) {
      if (createdAuth) await supabase.auth.admin.deleteUser(authUser.id);
      client.status = `error-perfil:${profileResult.error.message}`;
      writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
      writePrivate(csvFile, credentialCsv(manifest));
      throw profileResult.error;
    }

    client.status = createdAuth ? 'creada' : 'existente';
    writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    writePrivate(csvFile, credentialCsv(manifest));
  }

  if (deactivateUnlisted) {
    const { data: profiles, error } = await supabase.from('users').select('email,active');
    if (error) throw error;
    const unlisted = profiles.filter((profile) => !uniqueEmails.has(normalizeEmail(profile.email)));
    for (const profile of unlisted) {
      const result = await supabase
        .from('users')
        .update({ active: false })
        .eq('email', normalizeEmail(profile.email));
      if (result.error) throw result.error;
    }
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('users')
    .select('email,active');
  if (profilesError) throw profilesError;
  authUsers = await allAuthUsers(supabase);
  const activeRoster = profiles.filter(
    (profile) => profile.active && uniqueEmails.has(normalizeEmail(profile.email)),
  );
  const memberAuth = authUsers.filter(
    (user) => user.app_metadata?.role === 'member' && uniqueEmails.has(normalizeEmail(user.email)),
  );
  const adminAuth = authUsers.filter((user) => user.app_metadata?.role === 'admin');
  if (activeRoster.length !== expected || memberAuth.length !== expected || adminAuth.length < 1) {
    throw new Error(
      `Verificación final fallida: ${activeRoster.length} perfiles activos, ${memberAuth.length} cuentas miembro, ${adminAuth.length} administradores.`,
    );
  }

  manifest.completedAt = new Date().toISOString();
  writePrivate(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writePrivate(csvFile, credentialCsv(manifest));
  console.log(JSON.stringify({
    applied: true,
    activeRoster: activeRoster.length,
    memberAuth: memberAuth.length,
    admins: adminAuth.length,
    credentials: csvFile,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
