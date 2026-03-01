import React, { useState, useEffect, useRef } from 'react';
import { Camera, Search, History, Zap, ZapOff, X, Check, Package, ArrowLeft, AlertCircle, User, LogOut, MapPin, Lock } from 'lucide-react';

import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export default function App() {
  // État de l'authentification
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selectedStore, setSelectedStore] = useState('');
  
  // États de connexion
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // États de l'application principale
  const [activeTab, setActiveTab] = useState('scan');
  const [viewState, setViewState] = useState('camera'); 
  const [scannedCode, setScannedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [currentProduct, setCurrentProduct] = useState(null);
  const [history, setHistory] = useState([]);
  const [flashOn, setFlashOn] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // --- 1. GESTION DE L'AUTHENTIFICATION ---
  useEffect(() => {
    if (!supabase) return;

    // Récupérer la session active au démarrage
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });

    // Écouter les changements de connexion/déconnexion
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Récupérer le profil utilisateur (Nom, Prénom, Magasins)
  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (error) throw error;
      if (data) {
        setProfile(data);
        // Sélectionner le premier magasin par défaut s'il en a plusieurs
        if (data.magasins_autorises && data.magasins_autorises.length > 0) {
          setSelectedStore(data.magasins_autorises[0]);
        }
      }
    } catch (error) {
      console.error("Erreur profil:", error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      
      // Si "Se souvenir de moi" est décoché, on pourrait gérer le vidage du localstorage à la fermeture, 
      // mais par défaut Supabase sécurise très bien le token.
      if (!rememberMe) {
        sessionStorage.setItem('techscan_no_remember', 'true');
      }
      
    } catch (error) {
      setAuthError("Identifiants incorrects ou problème de connexion.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  // --- 2. LOGIQUE DE L'APPLICATION ---
  useEffect(() => {
    const savedHistory = localStorage.getItem('techscan_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));
  }, []);

  const handleSearch = async (code) => {
    setIsScanning(true);
    
    if (!supabase) {
      alert("Mode Production requis pour la recherche.");
      setIsScanning(false);
      return;
    }

    try {
      const { data: product, error } = await supabase
        .from('articles')
        .select('*')
        .eq('code_barre', code)
        .maybeSingle();
        
      if (error) throw error;

      // Traçabilité : On enregistre le scan dans l'historique global de l'entreprise
      if (session && selectedStore) {
        await supabase.from('historique_scans').insert([{
          user_id: session.user.id,
          magasin: selectedStore,
          code_barre: code,
          trouve: !!product
        }]);
      }

      setIsScanning(false);

      if (product) {
        setCurrentProduct(product);
        setViewState('product');
        addToHistory(product);
      } else {
        setScannedCode(code);
        setViewState('not-found');
      }
    } catch (error) {
      console.error("Erreur recherche:", error);
      setIsScanning(false);
      alert("Erreur de connexion à la base de données.");
    }
  };

  const addToHistory = (product) => {
    const newEntry = { ...product, scanDate: new Date().toISOString() };
    const newHistory = [newEntry, ...history.filter(h => h.code_barre !== product.code_barre)].slice(0, 50);
    setHistory(newHistory);
    localStorage.setItem('techscan_history', JSON.stringify(newHistory));
  };

  // Moteur Camera Scan Natif
  useEffect(() => {
    let stream = null;
    let scanInterval = null;

    const startScanner = async () => {
      // Ne lancer la caméra que si on est connecté et sur l'écran camera
      if (session && viewState === 'camera' && videoRef.current && navigator.mediaDevices) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            
            if ('BarcodeDetector' in window) {
              const barcodeDetector = new window.BarcodeDetector();
              scanInterval = setInterval(async () => {
                if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                  try {
                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0 && !isScanning) {
                      const code = barcodes[0].rawValue;
                      clearInterval(scanInterval);
                      handleSearch(code);
                    }
                  } catch (e) { /* silent error */ }
                }
              }, 300);
            }
          }
        } catch (err) {
          console.error("Erreur caméra:", err);
        }
      }
    };

    startScanner();

    return () => {
      if (scanInterval) clearInterval(scanInterval);
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [viewState, isScanning, session]);

  // Moteur Camera Photo
  useEffect(() => {
    let stream = null;
    if (session && viewState === 'take-photo' && navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
          stream = s;
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(err => console.error("Erreur photo:", err));
    }
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [viewState, session]);

  const takePicture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 600;
      canvas.height = video.videoHeight || 400;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      setCapturedPhoto(canvas.toDataURL('image/jpeg'));
      setViewState('photo-preview');
    }
  };

  const saveNewArticle = async () => {
    if (!supabase || !session) return;
    setIsUploading(true);

    try {
      const res = await fetch(capturedPhoto);
      const blob = await res.blob();
      const fileName = `${scannedCode}_${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('photos_articles')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
        
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('photos_articles')
        .getPublicUrl(fileName);

      // Traçabilité : On ajoute l'utilisateur et le magasin à la création
      const { error: dbError } = await supabase
        .from('articles_a_creer')
        .insert([{ 
          code_barre: scannedCode, 
          photo_url: publicUrlData.publicUrl, 
          statut: 'en_attente',
          cree_par: session.user.id,
          magasin: selectedStore
        }]);
        
      if (dbError) throw dbError;
      
      alert("Article enregistré avec succès !");
      resetToScan();
    } catch (error) {
      alert("Erreur lors de la sauvegarde.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetToScan = () => {
    setViewState('camera');
    setScannedCode('');
    setManualCode('');
    setCurrentProduct(null);
    setCapturedPhoto(null);
  };

  // --- 3. VUES DE L'APPLICATION ---

  // Écran "Configuration manquante"
  if (!supabase) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white p-8">
        <div className="bg-slate-800 p-8 rounded-3xl max-w-md w-full text-center shadow-2xl border border-slate-700">
          <AlertCircle size={64} className="mx-auto text-orange-500 mb-6" />
          <h1 className="text-2xl font-bold mb-4">Configuration Requise</h1>
          <p className="text-slate-400">Veuillez configurer vos variables d'environnement Vercel (VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY) et décommenter les lignes d'import Supabase dans votre projet pour utiliser l'application.</p>
        </div>
      </div>
    );
  }

  // Écran de Connexion
  if (!session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 p-6">
        <div className="bg-slate-800 p-8 md:p-10 rounded-3xl max-w-md w-full shadow-2xl border border-slate-700 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Package size={40} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white text-center mb-2">TechScan</h1>
          <p className="text-slate-400 text-center mb-8">Connectez-vous pour accéder au magasin</p>

          {authError && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl mb-6 text-sm text-center">
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Identifiant (Email)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><User size={20} /></div>
                <input 
                  type="email" required
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="prenom.nom@magasin.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Mot de passe</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><Lock size={20} /></div>
                <input 
                  type="password" required
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                  placeholder="••••••••"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input 
                type="checkbox" id="remember" 
                checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
              <label htmlFor="remember" className="text-sm text-slate-300 font-medium cursor-pointer">Se souvenir de moi</label>
            </div>

            <button 
              type="submit" disabled={authLoading}
              className="w-full py-4 mt-4 rounded-xl bg-blue-600 text-white text-lg font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-500 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {authLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Composants de l'application principale
  const renderCameraView = () => (
    <div className="relative w-full h-full bg-slate-900 overflow-hidden flex flex-col justify-center items-center">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-3/4 max-w-md aspect-video border-2 border-white/30 rounded-xl relative">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-lg"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-lg"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg"></div>
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
             {isScanning ? (
                <div className="w-full h-1 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-pulse" style={{ animation: 'scanline 1.5s linear infinite' }}></div>
             ) : (
                <span className="text-white/70 text-sm font-medium bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">Alignez le code-barres</span>
             )}
          </div>
        </div>
      </div>
      <div className="absolute top-6 right-6 flex gap-4">
        <button onClick={() => setFlashOn(!flashOn)} className={`p-4 rounded-full backdrop-blur-md transition-colors shadow-lg ${flashOn ? 'bg-yellow-400 text-black' : 'bg-white/20 text-white'}`}>
          {flashOn ? <Zap size={28} /> : <ZapOff size={28} />}
        </button>
      </div>
      <div className="absolute bottom-10 w-full px-8 flex justify-center items-center">
         <button onClick={() => setViewState('manual-entry')} className="bg-white/10 border border-white/20 backdrop-blur-md text-white px-6 py-4 rounded-2xl flex items-center gap-3 font-semibold hover:bg-white/20 transition shadow-xl">
            <Search size={24} />
            Saisie manuelle
         </button>
      </div>
    </div>
  );

  const renderManualEntry = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col p-8 animate-in fade-in zoom-in-95 duration-200">
      <button onClick={() => setViewState('camera')} className="w-fit p-4 rounded-full bg-white shadow-sm border border-slate-200 text-slate-600 mb-8 hover:bg-slate-100 transition">
        <ArrowLeft size={28} />
      </button>
      <div className="max-w-xl mx-auto w-full flex-1 flex flex-col justify-center">
        <h2 className="text-4xl font-extrabold text-slate-800 mb-3">Saisie manuelle</h2>
        <p className="text-lg text-slate-500 mb-10">Entrez le code-barres de l'article technique.</p>
        <div className="bg-white p-3 rounded-2xl shadow-sm border-2 border-slate-200 flex items-center focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/20 transition-all mb-8">
          <input 
            type="text" autoFocus
            className="flex-1 bg-transparent border-none text-3xl p-4 outline-none font-mono text-slate-800 uppercase placeholder:text-slate-300 placeholder:normal-case placeholder:text-2xl"
            placeholder="Ex: 316514..."
            value={manualCode} onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(manualCode)}
          />
          {manualCode && (
            <button onClick={() => setManualCode('')} className="p-3 bg-slate-100 rounded-xl text-slate-500 hover:text-slate-800 transition">
              <X size={24} />
            </button>
          )}
        </div>
        <button 
          onClick={() => handleSearch(manualCode)} disabled={!manualCode}
          className="w-full py-6 rounded-2xl bg-blue-600 text-white text-2xl font-bold disabled:opacity-50 disabled:bg-slate-300 shadow-xl shadow-blue-500/30 transition-all active:scale-[0.98] hover:bg-blue-700"
        >
          Rechercher l'article
        </button>
      </div>
    </div>
  );

  const renderProductCard = () => {
    if (!currentProduct) return null;
    const displayImage = currentProduct.image_reference || currentProduct.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=600';
    return (
      <div className="w-full h-full bg-slate-100 overflow-y-auto pb-24 animate-in slide-in-from-bottom-10 duration-300">
        <div className="relative h-80 bg-white flex justify-center items-center shadow-sm">
           <button onClick={resetToScan} className="absolute top-6 left-6 p-4 rounded-full bg-white/90 backdrop-blur shadow-lg text-slate-800 z-10 hover:bg-slate-100 transition"><X size={28} /></button>
           <img src={displayImage} alt={currentProduct.designation || 'Article'} className="h-full w-full object-cover" />
           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
           {currentProduct.statut && (
             <div className="absolute top-6 right-6">
                <span className={`px-4 py-2 rounded-full text-sm font-bold shadow-lg backdrop-blur-md ${currentProduct.statut === 'Actif' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'}`}>{currentProduct.statut}</span>
             </div>
           )}
           <div className="absolute bottom-0 left-0 right-0 p-8">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {currentProduct.groupe && <span className="px-3 py-1 bg-white/20 backdrop-blur border border-white/30 text-white text-xs font-bold rounded-full">{currentProduct.groupe}</span>}
                {currentProduct.famille && <span className="text-white/50 text-xs font-bold">&gt;</span>}
                {currentProduct.famille && <span className="px-3 py-1 bg-white/20 backdrop-blur border border-white/30 text-white text-xs font-bold rounded-full">{currentProduct.famille}</span>}
                {currentProduct.type && <span className="text-white/50 text-xs font-bold">&gt;</span>}
                {currentProduct.type && <span className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full shadow-lg">{currentProduct.type}</span>}
              </div>
              <h1 className="text-4xl font-extrabold text-white leading-tight drop-shadow-md">{currentProduct.designation || 'Désignation inconnue'}</h1>
           </div>
        </div>
        <div className="max-w-4xl mx-auto p-6 space-y-6 -mt-6 relative z-20">
          <div className="bg-white rounded-3xl p-6 shadow-xl shadow-slate-200/50 border border-slate-100 flex flex-wrap md:flex-nowrap items-center justify-between gap-4">
            <div className="flex-1 min-w-[150px]">
              <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mb-1">Marque</p>
              <p className="text-2xl font-black text-slate-800">{currentProduct.marque || 'N/A'}</p>
            </div>
            <div className="hidden md:block h-16 w-px bg-slate-200 mx-4"></div>
            <div className="flex-1 min-w-[150px] md:text-center border-l border-slate-200 pl-4 md:border-none md:pl-0">
              <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mb-1">Réf. Fabricant</p>
              <p className="text-2xl font-mono font-bold text-slate-800">{currentProduct.reference_fabricant || 'N/A'}</p>
            </div>
            <div className="hidden md:block h-16 w-px bg-slate-200 mx-4"></div>
            <div className="w-full md:w-auto md:text-right mt-4 md:mt-0 bg-slate-50 md:bg-transparent p-4 md:p-0 rounded-xl">
              <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mb-1">Code Barre</p>
              <p className="text-xl font-mono font-bold text-slate-800">{currentProduct.code_barre}</p>
            </div>
          </div>
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
              <Package className="text-blue-500" size={28} /> Détails de l'article
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <span className="block text-xs text-slate-400 uppercase font-bold mb-2 tracking-wider">Site de rattachement</span>
                <span className="block text-lg font-bold text-slate-800">{currentProduct.site_rattachement || 'Non défini'}</span>
              </div>
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100">
                <span className="block text-xs text-slate-400 uppercase font-bold mb-2 tracking-wider">Date de création</span>
                <span className="block text-lg font-bold text-slate-800">
                  {currentProduct.date_creation ? new Date(currentProduct.date_creation).toLocaleDateString('fr-FR') : 'Inconnue'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderNotFound = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col p-8 animate-in slide-in-from-right duration-200">
      <div className="flex justify-between items-center mb-12">
        <button onClick={resetToScan} className="p-4 rounded-full bg-white shadow-sm border border-slate-200 text-slate-600 hover:bg-slate-100"><X size={28} /></button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center max-w-xl mx-auto w-full">
        <div className="w-32 h-32 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mb-8 shadow-inner border-8 border-white">
          <AlertCircle size={64} strokeWidth={2.5} />
        </div>
        <h2 className="text-4xl font-black text-slate-800 mb-4">Article introuvable</h2>
        <p className="text-xl text-slate-600 mb-4">Le code <strong className="font-mono text-slate-900 bg-white border border-slate-200 shadow-sm px-3 py-1 rounded-lg">{scannedCode}</strong> n'est pas dans notre base.</p>
        <button 
          onClick={() => setViewState('take-photo')}
          className="w-full py-6 rounded-2xl bg-blue-600 text-white text-2xl font-bold shadow-xl shadow-blue-500/30 flex items-center justify-center gap-4 active:scale-95 transition-all hover:bg-blue-700"
        >
          <Camera size={32} /> Prendre une photo
        </button>
        <button onClick={resetToScan} className="mt-8 text-slate-500 font-bold text-lg hover:text-slate-800 py-4">Ignorer et re-scanner</button>
      </div>
    </div>
  );

  const renderTakePhoto = () => (
    <div className="relative w-full h-full bg-black flex flex-col animate-in zoom-in-95 duration-200">
      <div className="absolute top-6 left-6 z-10">
         <button onClick={() => setViewState('not-found')} className="p-4 rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70 transition"><ArrowLeft size={28} /></button>
      </div>
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 border-[15px] border-black/40 pointer-events-none"></div>
        <div className="absolute inset-10 border-2 border-dashed border-white/50 rounded-3xl pointer-events-none flex items-center justify-center">
          <span className="bg-black/50 text-white px-4 py-2 rounded-full backdrop-blur-sm text-sm font-bold">Cadrez la pièce technique</span>
        </div>
      </div>
      <div className="h-48 bg-black flex items-center justify-center pb-8 border-t border-white/10">
        <button onClick={takePicture} className="w-24 h-24 rounded-full border-4 border-white flex items-center justify-center active:scale-90 transition-transform bg-black hover:bg-white/10">
          <div className="w-20 h-20 bg-white rounded-full"></div>
        </button>
      </div>
    </div>
  );

  const renderPhotoPreview = () => (
    <div className="w-full h-full bg-slate-900 flex flex-col animate-in fade-in duration-200">
       <div className="flex-1 relative p-8 flex flex-col justify-center">
         <h3 className="text-white text-center text-3xl font-bold mb-8">La photo est-elle nette ?</h3>
         <div className="w-full max-w-2xl mx-auto rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-700 bg-black">
           <img src={capturedPhoto} alt="Aperçu" className="w-full h-auto object-contain max-h-[50vh]" />
         </div>
       </div>
       <div className="bg-slate-800 p-8 flex gap-6 pb-12">
          <button onClick={() => setViewState('take-photo')} disabled={isUploading} className="flex-1 py-6 rounded-2xl bg-slate-700 hover:bg-slate-600 text-white text-xl font-bold flex items-center justify-center gap-3 transition disabled:opacity-50">
            <X size={28} /> Refaire
          </button>
          <button onClick={saveNewArticle} disabled={isUploading} className="flex-1 py-6 rounded-2xl bg-green-500 hover:bg-green-400 text-white text-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-green-500/20 transition disabled:opacity-50">
            {isUploading ? <span className="animate-pulse">Envoi en cours...</span> : <><Check size={28} /> Valider l'ajout</>}
          </button>
       </div>
    </div>
  );

  const renderHistory = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col">
      <div className="bg-white p-6 shadow-sm z-10 sticky top-0 flex items-center gap-4">
        <button onClick={() => setActiveTab('scan')} className="p-2 -ml-2 text-slate-600 md:hidden"><ArrowLeft size={28}/></button>
        <h2 className="text-3xl font-extrabold text-slate-800 flex items-center gap-3"><History className="text-blue-600" size={32} /> Historique local</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Package size={80} className="mb-6 opacity-30" />
            <p className="text-xl font-medium">Aucun article scanné récemment</p>
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={`${item.code_barre}-${idx}`} onClick={() => { setCurrentProduct(item); setViewState('product'); if(window.innerWidth < 768) setActiveTab('scan'); }} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-6 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all active:scale-[0.98]">
              <img src={item.image_reference || item.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=100'} alt={item.designation} className="w-20 h-20 rounded-2xl object-cover bg-slate-100 border border-slate-100" />
              <div className="flex-1 min-w-0">
                <h4 className="text-xl font-bold text-slate-800 truncate mb-1">{item.designation || 'Article'}</h4>
                <p className="text-md text-slate-500 truncate font-medium">{item.marque || 'Marque N/A'} <span className="text-slate-300 mx-2">•</span> {item.reference_fabricant || 'Réf N/A'}</p>
              </div>
              <div className="text-right pl-4 hidden sm:block">
                <span className="text-sm font-mono font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">{item.code_barre}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-slate-900 font-sans text-slate-900 overflow-hidden flex-col md:flex-row">
      
      {/* HEADER TOP (Nouvelle barre Utilisateur) */}
      <div className="md:hidden w-full bg-white border-b border-slate-200 px-4 py-3 flex justify-between items-center z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
            {profile?.prenom?.charAt(0) || <User size={20} />}
          </div>
          <div className="flex flex-col">
             <span className="text-sm font-bold leading-tight">{profile?.prenom} {profile?.nom}</span>
             {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
                <select 
                  value={selectedStore} 
                  onChange={(e) => setSelectedStore(e.target.value)}
                  className="text-xs text-slate-500 bg-transparent outline-none font-medium p-0 border-none cursor-pointer"
                >
                  {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
             ) : (
                <span className="text-xs text-slate-500 font-medium flex items-center gap-1"><MapPin size={10}/> {selectedStore || 'Magasin N/A'}</span>
             )}
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><LogOut size={24} /></button>
      </div>

      <nav className={`
        bg-white border-slate-200 flex z-50
        max-md:fixed max-md:bottom-0 max-md:w-full max-md:flex-row max-md:h-24 max-md:border-t max-md:justify-around max-md:items-center max-md:pb-4
        md:flex-col md:w-32 md:h-full md:border-r md:py-8 md:items-center md:justify-start md:gap-8
      `}>
        <div className="hidden md:flex flex-col items-center justify-center w-16 h-16 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-500/30 mb-8">
          <Package size={32} />
        </div>

        {/* Profil Desktop */}
        <div className="hidden md:flex flex-col items-center gap-2 mb-8 w-full px-2 border-b border-slate-100 pb-8">
          <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xl mb-1">
            {profile?.prenom?.charAt(0) || <User size={24} />}
          </div>
          <span className="text-xs font-bold text-center w-full truncate px-2">{profile?.prenom}</span>
          
          {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
            <select 
              value={selectedStore} 
              onChange={(e) => setSelectedStore(e.target.value)}
              className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-1 w-full outline-none mt-1 text-center"
            >
              {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <span className="text-[10px] text-slate-400 text-center flex items-center gap-1 mt-1 bg-slate-50 px-2 py-1 rounded"><MapPin size={10}/> {selectedStore || 'N/A'}</span>
          )}
          
          <button onClick={handleLogout} className="mt-4 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Se déconnecter"><LogOut size={20} /></button>
        </div>

        <button onClick={() => { setActiveTab('scan'); if(viewState !== 'camera') resetToScan(); }} className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${activeTab === 'scan' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
          <Camera size={32} strokeWidth={activeTab === 'scan' ? 2.5 : 2} />
          <span className="text-sm font-bold">Scanner</span>
        </button>

        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${activeTab === 'history' ? 'text-blue-600 scale-110' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
          <History size={32} strokeWidth={activeTab === 'history' ? 2.5 : 2} />
          <span className="text-sm font-bold">Historique</span>
        </button>
      </nav>

      <main className="flex-1 relative flex bg-slate-100 md:rounded-l-[2.5rem] overflow-hidden max-md:rounded-none h-full">
        <div className={`w-full h-full max-md:pb-24 ${activeTab === 'history' ? 'block' : 'hidden'}`}>
           {renderHistory()}
        </div>
        <div className={`w-full h-full max-md:pb-24 ${activeTab === 'scan' ? 'block' : 'hidden'}`}>
          {viewState === 'camera' && renderCameraView()}
          {viewState === 'manual-entry' && renderManualEntry()}
          {viewState === 'product' && renderProductCard()}
          {viewState === 'not-found' && renderNotFound()}
          {viewState === 'take-photo' && renderTakePhoto()}
          {viewState === 'photo-preview' && renderPhotoPreview()}
        </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scanline { 0% { transform: translateY(-120px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(120px); opacity: 0; } }
      `}} />
    </div>
  );
}