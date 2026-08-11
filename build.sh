#!/bin/bash
# 🛠️ Astrid Sophia - Build Script (Linux/macOS)
# Compila el proyecto completo: frontend + backend Tauri

set -e  # Salir en caso de error

echo "========================================"
echo "🚀 Astrid Sophia - Build Script v1.0"
echo "========================================"
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_step() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Verificar dependencias
echo "📋 Verificando dependencias..."

if ! command -v node &> /dev/null; then
    print_error "Node.js no está instalado. Por favor instálalo desde https://nodejs.org/"
    exit 1
fi
print_step "Node.js: $(node --version)"

if ! command -v npm &> /dev/null; then
    print_error "npm no está instalado."
    exit 1
fi
print_step "npm: $(npm --version)"

if ! command -v rustc &> /dev/null; then
    print_error "Rust no está instalado. Por favor instálalo desde https://rustup.rs/"
    exit 1
fi
print_step "Rust: $(rustc --version)"

if ! command -v cargo &> /dev/null; then
    print_error "Cargo no está instalado."
    exit 1
fi
print_step "Cargo: $(cargo --version)"

echo ""

# Limpiar build anterior (opcional)
if [ "$1" == "--clean" ]; then
    echo "🧹 Limpiando builds anteriores..."
    rm -rf dist/
    rm -rf src-tauri/target/
    print_step "Limpieza completada"
    echo ""
fi

# Instalar dependencias de frontend
echo "📦 Instalando dependencias de frontend..."
npm install --silent
print_step "Dependencias instaladas"
echo ""

# Build del frontend con Vite
echo "🏗️  Compilando frontend (Vite)..."
npm run build
print_step "Frontend compilado en dist/"
echo ""

# Verificar código Rust
echo "🔍 Verificando código Rust..."
cd src-tauri
cargo check --release
print_step "Código Rust verificado"
echo ""

# Ejecutar tests de Rust (opcional, se puede saltar con --no-test)
if [ "$2" != "--no-test" ]; then
    echo "🧪 Ejecutando tests de Rust..."
    cargo test --release --quiet
    print_step "Tests de Rust aprobados"
    echo ""
else
    print_warning "Saltando tests de Rust"
    echo ""
fi

# Build de producción de Tauri
echo "📦 Empaquetando aplicación Tauri..."
if [ "$1" == "--debug" ]; then
    npm run tauri build -- --debug
    print_step "Build debug completada en src-tauri/target/debug/bundle/"
else
    npm run tauri build
    print_step "Build release completada en src-tauri/target/release/bundle/"
fi

echo ""
echo "========================================"
echo -e "${GREEN}✅ Build completada exitosamente${NC}"
echo "========================================"
echo ""
echo "📁 Archivos generados:"
echo "   - Frontend: dist/"
echo "   - Backend:  src-tauri/target/*/bundle/"
echo ""
echo "🚀 Para ejecutar en modo desarrollo:"
echo "   npm run dev"
echo ""
