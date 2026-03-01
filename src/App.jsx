import React, { useState, useEffect, useRef } from 'react';
import { Camera, Search, History, Zap, ZapOff, X, Check, Package, ArrowLeft, AlertCircle, User, LogOut, MapPin, Lock, ChevronDown } from 'lucide-react';

import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [selectedStore, setSelectedStore] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  // Notification in-app pour remplacer les alert()
  const [toastMessage, setToastMessage] = useState(null);

  const [activeTab, setActiveTab] = useState('scan');
  const [viewState, setViewState] = useState('camera'); 
  const [scannedCode, setScannedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [currentProduct, setCurrentProduct] = useState(null);
  
  // État pour gérer le "tiroir" (Bottom Sheet) façon Yuka
  const [isProductExpanded, setIsProductExpanded] = useState(false);

  const [history, setHistory] = useState([]);
  const [flashOn, setFlashOn] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // --- RÉFÉRENCES POUR LA CAMÉRA (Évite les bugs de boucle) ---
  const stateRef = useRef({ viewState, isScanning, scannedCode: '', lastScanTime: 0, isProductExpanded: false });
  useEffect(() => {
    stateRef.current.viewState = viewState;
    stateRef.current.isScanning = isScanning;
    stateRef.current.scannedCode = scannedCode;
    stateRef.current.isProductExpanded = isProductExpanded;
  }, [viewState, isScanning, scannedCode, isProductExpanded]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- 1. GESTION DE L'AUTHENTIFICATION ---
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      if (data) {
        setProfile(data);
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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!rememberMe) sessionStorage.setItem('techscan_no_remember', 'true');
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
    setScannedCode(code);
    
    // Mise à jour immédiate de la réf pour bloquer les scans multiples inutiles
    stateRef.current.isScanning = true;
    stateRef.current.scannedCode = code;
    stateRef.current.lastScanTime = Date.now();
    
    if (!supabase) {
      showToast("Mode de test : Recherche simulée pour " + code);
      setIsScanning(false);
      stateRef.current.isScanning = false;
      setViewState('not-found');
      return;
    }

    try {
      const { data: product, error } = await supabase
        .from('articles')
        .select('*')
        .eq('code_barre', code)
        .maybeSingle();
        
      if (error) throw error;

      if (session && selectedStore) {
        await supabase.from('historique_scans').insert([{
          user_id: session.user.id,
          magasin: selectedStore,
          code_barre: code,
          trouve: !!product
        }]);
      }

      setIsScanning(false);
      stateRef.current.isScanning = false;

      if (product) {
        setCurrentProduct(product);
        setIsProductExpanded(false); // Affiche la carte compacte en bas (Tiroir)
        setViewState('product');
        addToHistory(product);
      } else {
        setViewState('not-found');
      }
    } catch (error) {
      setIsScanning(false);
      stateRef.current.isScanning = false;
      showToast("Erreur de connexion à la base de données.");
    }
  };

  const addToHistory = (product) => {
    const newEntry = { ...product, scanDate: new Date().toISOString() };
    const newHistory = [newEntry, ...history.filter(h => h.code_barre !== product.code_barre)].slice(0, 50);
    setHistory(newHistory);
    localStorage.setItem('techscan_history', JSON.stringify(newHistory));
  };

  // Moteur Camera Scan Natif (Optimisé pour scanner en fond sous les tiroirs Yuka)
  useEffect(() => {
    let stream = null;
    let scanInterval = null;

    const startScanner = async () => {
      // La caméra reste active même en affichant un produit ou une erreur "not-found"
      if (session && activeTab === 'scan' && (viewState === 'camera' || viewState === 'product' || viewState === 'not-found') && videoRef.current && navigator.mediaDevices) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            
            if ('BarcodeDetector' in window) {
              const barcodeDetector = new window.BarcodeDetector();
              scanInterval = setInterval(async () => {
                
                // On scanne uniquement si on n'est pas en train de charger, et que la fiche PLEIN ÉCRAN n'est pas ouverte
                if ((stateRef.current.viewState === 'camera' || stateRef.current.viewState === 'product' || stateRef.current.viewState === 'not-found') 
                    && !stateRef.current.isScanning 
                    && !stateRef.current.isProductExpanded 
                    && videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
                  try {
                    const barcodes = await barcodeDetector.detect(videoRef.current);
                    if (barcodes.length > 0) {
                      const code = barcodes[0].rawValue;
                      const now = Date.now();
                      
                      // SCAN FLUIDE: 
                      // 1. Un nouveau code met à jour l'écran immédiatement (passe à la nouvelle fiche)
                      // 2. Le MÊME code est ignoré sauf si on reste dessus 2.5 secondes
                      if (code !== stateRef.current.scannedCode || (now - stateRef.current.lastScanTime > 2500)) {
                         handleSearch(code);
                      }
                    }
                  } catch (e) { /* silent */ }
                }
              }, 400);
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
  }, [activeTab, session]); 

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

      const { error: uploadError } = await supabase.storage.from('photos_articles').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('photos_articles').getPublicUrl(fileName);

      const { error: dbError } = await supabase.from('articles_a_creer').insert([{ 
          code_barre: scannedCode, photo_url: publicUrlData.publicUrl, statut: 'en_attente', cree_par: session.user.id, magasin: selectedStore
      }]);
      if (dbError) throw dbError;
      
      showToast("Article enregistré avec succès !");
      resetToScan();
    } catch (error) {
      showToast("Erreur lors de la sauvegarde.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetToScan = () => {
    setViewState('camera');
    setScannedCode(''); // Vider le code permet un rescan immédiat sans attendre 2.5s
    setManualCode('');
    setCurrentProduct(null);
    setCapturedPhoto(null);
    setIsProductExpanded(false);
  };

  // --- 3. VUES DE L'APPLICATION ---

  if (!supabase) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white p-8">
        <div className="bg-slate-800 p-8 max-w-md w-full text-center border border-slate-700">
          <AlertCircle size={64} className="mx-auto text-orange-500 mb-6" />
          <h1 className="text-2xl font-bold mb-4">Configuration Requise</h1>
          <p className="text-slate-400">Veuillez configurer vos variables d'environnement Vercel et décommenter les lignes Supabase.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 p-6">
        <div className="bg-slate-800 p-8 md:p-10 max-w-md w-full shadow-2xl border border-slate-700 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Package size={40} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white text-center mb-2">TechScan</h1>
          <p className="text-slate-400 text-center mb-8">Connectez-vous pour accéder au magasin</p>

          {authError && <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 mb-6 text-sm text-center">{authError}</div>}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Identifiant (Email)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><User size={20} /></div>
                <input type="email" required className="w-full bg-slate-900 border border-slate-700 text-white py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500" placeholder="prenom.nom@magasin.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-slate-300 text-sm font-bold mb-2 block">Mot de passe</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500"><Lock size={20} /></div>
                <input type="password" required className="w-full bg-slate-900 border border-slate-700 text-white py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <input type="checkbox" id="remember" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-5 h-5 bg-slate-900 text-blue-600 border-none outline-none" />
              <label htmlFor="remember" className="text-sm text-slate-300 font-medium cursor-pointer">Se souvenir de moi</label>
            </div>
            <button type="submit" disabled={authLoading} className="w-full py-4 mt-4 bg-blue-600 text-white text-lg font-bold shadow-lg shadow-blue-500/30 hover:bg-blue-500 active:scale-[0.98] transition-all disabled:opacity-50">
              {authLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- VUES SECONDAIRES ---

  const renderCameraView = () => (
    <div className="absolute inset-0 w-full h-full bg-slate-900 overflow-hidden flex flex-col justify-center items-center">
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover opacity-80" />
      
      {/* Cadre de visée: Visible si scan pur OU si un tiroir est ouvert (pour comprendre qu'on peut scanner à travers) */}
      {(viewState === 'camera' || (viewState === 'product' && !isProductExpanded) || viewState === 'not-found') && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-3/4 max-w-md aspect-video border border-white/40 relative bg-white/5">
            {/* Design angles droits purs */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500"></div>
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500"></div>
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500"></div>
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500"></div>
            
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
               {isScanning ? (
                  <div className="w-full h-1 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-pulse" style={{ animation: 'scanline 1.5s linear infinite' }}></div>
               ) : (
                  <span className="text-white/80 text-sm font-bold bg-black/60 px-4 py-2 backdrop-blur-md">Alignez le code-barres</span>
               )}
            </div>
          </div>
        </div>
      )}

      {/* Boutons d'action uniquement si la vue principale est dégagée */}
      {viewState === 'camera' && (
        <>
          <div className="absolute top-6 right-6 flex gap-4 z-20">
            <button onClick={() => setFlashOn(!flashOn)} className={`p-4 backdrop-blur-md transition-colors shadow-lg ${flashOn ? 'bg-yellow-400 text-black' : 'bg-black/40 text-white'}`}>
              {flashOn ? <Zap size={28} /> : <ZapOff size={28} />}
            </button>
          </div>
          <div className="absolute bottom-10 w-full px-8 flex justify-center items-center z-20">
             <button onClick={() => setViewState('manual-entry')} className="bg-black/60 border border-white/20 backdrop-blur-md text-white px-6 py-4 flex items-center gap-3 font-semibold hover:bg-black/80 transition shadow-xl">
                <Search size={24} /> Saisie manuelle
             </button>
          </div>
        </>
      )}
    </div>
  );

  // --- OVERLAYS: PRODUIT ET INTROUVABLE (YUKA STYLE) ---
  
  const renderProductOverlay = () => {
    if (!currentProduct) return null;
    const displayImage = currentProduct.image_reference || currentProduct.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=600';

    if (!isProductExpanded) {
      // 1. MODE COMPACT (Tiroir) - Zéro bord arrondi (ou très léger pour la base UI)
      return (
        <div 
          className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-15px_50px_rgba(0,0,0,0.25)] z-[60] animate-in slide-in-from-bottom-full duration-300 cursor-pointer overflow-hidden pb-8 max-md:pb-28 border-t-4 border-blue-500"
          onClick={() => setIsProductExpanded(true)}
        >
          <div className="w-16 h-1.5 bg-slate-200 mx-auto mt-4 mb-2"></div>
          
          <div className="p-5 flex gap-4 items-center">
            {/* Image en ENTIER sans rognage, coins droits */}
            <div className="w-24 h-24 md:w-28 md:h-28 bg-white border border-slate-200 flex items-center justify-center shrink-0 p-1">
              <img src={displayImage} alt="..." className="max-w-full max-h-full object-contain" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-center">
               <h3 className="text-xl md:text-2xl font-black text-slate-800 leading-tight truncate mb-1">{currentProduct.designation || 'Article'}</h3>
               <p className="text-md font-bold text-slate-500 truncate">{currentProduct.marque || 'Marque N/A'}</p>
               <p className="text-xs font-mono font-bold text-slate-400 mt-1">{currentProduct.code_barre}</p>
            </div>
            
            <div className="flex flex-col items-center justify-center shrink-0 ml-2">
               <div className={`w-4 h-4 mb-1 ${currentProduct.statut === 'Actif' ? 'bg-green-500' : currentProduct.statut ? 'bg-orange-500' : 'bg-slate-300'}`}></div>
               <span className="text-[10px] font-black text-slate-500 uppercase">{currentProduct.statut || 'Info'}</span>
            </div>
          </div>
        </div>
      );
    }

    // 2. MODE PLEIN ÉCRAN (Fiche détaillée industrielle - Bords stricts)
    return (
      <div className="absolute inset-0 bg-slate-50 z-[70] overflow-y-auto animate-in slide-in-from-bottom-10 duration-300 pb-24 md:pb-0">
        
        {/* Header avec image ENTIÈRE */}
        <div className="relative h-72 bg-white flex justify-center items-center shadow-sm p-8 pt-16 border-b border-slate-200">
           <button 
             onClick={(e) => { 
                e.stopPropagation(); 
                activeTab === 'history' ? resetToScan() : setIsProductExpanded(false); 
             }} 
             className="absolute top-6 left-6 p-3 bg-slate-100 text-slate-800 border border-slate-200 z-10 hover:bg-slate-200 transition"
           >
             {activeTab === 'history' ? <ArrowLeft size={24} /> : <ChevronDown size={24} />}
           </button>
           
           <img src={displayImage} alt={currentProduct.designation} className="max-w-full max-h-full object-contain drop-shadow-sm" />
        </div>

        <div className="max-w-3xl mx-auto -mt-4 relative z-20 px-4 space-y-4">
           {/* Titre & Statut */}
           <div className="bg-white p-6 shadow-sm border border-slate-200">
              <div className="flex justify-between items-start mb-4 gap-4">
                 <div className="flex-1">
                    <h1 className="text-3xl md:text-4xl font-black text-slate-800 leading-tight uppercase">{currentProduct.designation || 'Article'}</h1>
                    <p className="text-lg text-slate-500 font-bold mt-1">{currentProduct.marque || 'Marque N/A'}</p>
                 </div>
                 {currentProduct.statut && (
                   <div className={`px-4 py-2 flex flex-col items-center justify-center border-2 ${currentProduct.statut === 'Actif' ? 'bg-green-50 text-green-700 border-green-500' : 'bg-orange-50 text-orange-700 border-orange-500'}`}>
                      <span className="text-sm font-black uppercase tracking-wider">{currentProduct.statut}</span>
                   </div>
                 )}
              </div>
              
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                {currentProduct.groupe && <span className="px-3 py-1 bg-slate-800 text-white text-xs font-bold uppercase">{currentProduct.groupe}</span>}
                {currentProduct.famille && <span className="px-3 py-1 bg-slate-200 text-slate-700 text-xs font-bold uppercase">{currentProduct.famille}</span>}
                {currentProduct.type && <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold uppercase border border-blue-300">{currentProduct.type}</span>}
              </div>
           </div>

           {/* Liste des caractéristiques */}
           <div className="bg-white shadow-sm border border-slate-200">
              <div className="px-6 py-4 bg-slate-100 border-b border-slate-200">
                 <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 uppercase">
                   <Package size={20} className="text-blue-600" /> Détails techniques
                 </h3>
              </div>
              
              <div className="p-2">
                 <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><Search size={20} /></div>
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase">Code Barre</p>
                          <p className="text-sm text-slate-500 font-mono font-bold mt-1">{currentProduct.code_barre}</p>
                       </div>
                    </div>
                 </div>
                 
                 <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><AlertCircle size={20} /></div>
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase">Réf. Fabricant</p>
                          <p className="text-sm text-slate-500 font-mono font-bold mt-1">{currentProduct.reference_fabricant || 'Non renseignée'}</p>
                       </div>
                    </div>
                 </div>

                 <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><MapPin size={20} /></div>
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase">Emplacement / Magasin</p>
                          <p className="text-sm font-bold text-slate-500 mt-1">{currentProduct.site_rattachement || 'Non défini'}</p>
                       </div>
                    </div>
                 </div>

                 <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 bg-slate-100 flex items-center justify-center text-slate-500 border border-slate-200"><History size={20} /></div>
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase">Date d'ajout</p>
                          <p className="text-sm font-bold text-slate-500 mt-1">
                             {currentProduct.date_creation ? new Date(currentProduct.date_creation).toLocaleDateString('fr-FR') : 'Inconnue'}
                          </p>
                       </div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>
    );
  };

  const renderNotFoundOverlay = () => {
    return (
      <div className="absolute bottom-0 left-0 right-0 bg-white border-t-4 border-orange-500 shadow-[0_-15px_50px_rgba(0,0,0,0.25)] z-[60] animate-in slide-in-from-bottom-full duration-300 p-6 pb-8 max-md:pb-28">
         <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-4">
               <div className="w-14 h-14 bg-orange-50 text-orange-600 flex items-center justify-center shrink-0 border border-orange-200">
                  <AlertCircle size={32} />
               </div>
               <div>
                  <h3 className="text-2xl font-black text-slate-800 leading-tight uppercase">Introuvable</h3>
                  <p className="text-sm font-mono font-bold text-slate-500 mt-1">{scannedCode}</p>
               </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); resetToScan(); }} className="p-3 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition border border-slate-200">
               <X size={24} />
            </button>
         </div>
         <button onClick={() => setViewState('take-photo')} className="w-full py-4 mt-2 bg-blue-600 text-white text-lg font-bold flex items-center justify-center gap-3 hover:bg-blue-700 transition uppercase">
            <Camera size={24} /> Créer la fiche produit
         </button>
      </div>
    );
  };

  const renderManualEntry = () => (
    <div className="absolute inset-0 bg-slate-50 flex flex-col p-8 animate-in fade-in duration-200 z-[60]">
      <button onClick={() => setViewState('camera')} className="w-fit p-4 bg-white shadow-sm border border-slate-200 text-slate-600 mb-8 hover:bg-slate-100 transition"><ArrowLeft size={28} /></button>
      <div className="max-w-xl mx-auto w-full flex-1 flex flex-col justify-center">
        <h2 className="text-4xl font-black text-slate-800 mb-3 uppercase">Saisie manuelle</h2>
        <div className="bg-white p-3 shadow-sm border-2 border-slate-300 flex items-center mb-8">
          <input type="text" autoFocus className="flex-1 bg-transparent border-none text-3xl p-4 outline-none font-mono text-slate-800 uppercase" placeholder="Ex: 316514..." value={manualCode} onChange={(e) => setManualCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch(manualCode)} />
        </div>
        <button onClick={() => handleSearch(manualCode)} disabled={!manualCode} className="w-full py-6 bg-blue-600 text-white text-2xl font-bold disabled:opacity-50 uppercase">Rechercher l'article</button>
      </div>
    </div>
  );

  const renderTakePhoto = () => (
    <div className="relative w-full h-full bg-black flex flex-col animate-in zoom-in-95 duration-200 z-[60]">
      <div className="absolute top-6 left-6 z-10">
         <button onClick={() => setViewState('not-found')} className="p-4 bg-black/50 border border-white/20 text-white backdrop-blur-md hover:bg-black/70 transition"><ArrowLeft size={28} /></button>
      </div>
      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 border-[15px] border-black/40 pointer-events-none"></div>
        <div className="absolute inset-10 border-2 border-dashed border-white/50 pointer-events-none flex items-center justify-center">
          <span className="bg-black/50 text-white px-4 py-2 backdrop-blur-sm text-sm font-bold uppercase tracking-wider">Cadrez la pièce</span>
        </div>
      </div>
      <div className="h-48 bg-black flex items-center justify-center pb-8 border-t border-white/10">
        <button onClick={takePicture} className="w-24 h-24 border-4 border-white flex items-center justify-center active:scale-90 transition-transform bg-black hover:bg-white/10">
          <div className="w-20 h-20 bg-white"></div>
        </button>
      </div>
    </div>
  );

  const renderPhotoPreview = () => (
    <div className="absolute inset-0 bg-slate-900 flex flex-col animate-in fade-in duration-200 z-[60]">
       <div className="flex-1 relative p-8 flex flex-col justify-center">
         <h3 className="text-white text-center text-3xl font-black uppercase tracking-wider mb-8">Image Nette ?</h3>
         <div className="w-full max-w-2xl mx-auto overflow-hidden shadow-2xl border-4 border-slate-700 bg-black">
           <img src={capturedPhoto} alt="Aperçu" className="w-full h-auto object-contain max-h-[50vh]" />
         </div>
       </div>
       <div className="bg-slate-800 p-8 flex gap-6 pb-12">
          <button onClick={() => setViewState('take-photo')} disabled={isUploading} className="flex-1 py-6 bg-slate-700 border border-slate-600 hover:bg-slate-600 text-white text-xl font-bold flex items-center justify-center gap-3 transition uppercase disabled:opacity-50">
            <X size={28} /> Refaire
          </button>
          <button onClick={saveNewArticle} disabled={isUploading} className="flex-1 py-6 bg-green-600 hover:bg-green-500 text-white text-xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-green-500/20 transition uppercase disabled:opacity-50">
            {isUploading ? <span className="animate-pulse">Envoi...</span> : <><Check size={28} /> Valider</>}
          </button>
       </div>
    </div>
  );

  const renderHistory = () => (
    <div className="w-full h-full bg-slate-50 flex flex-col">
      <div className="bg-white p-6 shadow-sm z-10 sticky top-0 flex items-center gap-4 border-b border-slate-200">
        <button onClick={() => setActiveTab('scan')} className="p-2 -ml-2 text-slate-600 md:hidden border border-slate-100 bg-slate-50 hover:bg-slate-100"><ArrowLeft size={28}/></button>
        <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3 uppercase tracking-tight"><History className="text-blue-600" size={32} /> Historique</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Package size={80} className="mb-6 opacity-30" />
            <p className="text-xl font-bold uppercase">Aucun article scanné</p>
          </div>
        ) : (
          history.map((item) => (
            <div key={item.code_barre} 
                 onClick={() => { 
                    setCurrentProduct(item); 
                    setIsProductExpanded(true); // Ouvre en plein écran
                    setViewState('product'); 
                 }} 
                 className="bg-white p-5 shadow-sm border border-slate-200 flex items-center gap-6 cursor-pointer hover:bg-slate-50 transition-all active:scale-[0.99]">
              <div className="w-20 h-20 bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0">
                 <img src={item.image_reference || item.photo || 'https://images.unsplash.com/photo-1586772002130-b0f3daa6288b?auto=format&fit=crop&q=80&w=100'} alt="..." className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xl font-black text-slate-800 truncate mb-1 uppercase">{item.designation || 'Article'}</h4>
                <p className="text-md text-slate-500 font-bold truncate">{item.marque || 'Marque N/A'} <span className="text-slate-300 mx-2">•</span> {item.reference_fabricant || 'Réf N/A'}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen w-full bg-slate-900 font-sans text-slate-900 overflow-hidden flex-col md:flex-row relative">
      
      {/* Notifications Toasts */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-4 shadow-2xl z-[100] font-bold text-sm text-center border-l-4 border-blue-500 uppercase tracking-wide">
           {toastMessage}
        </div>
      )}

      {/* HEADER TOP (Mobile) - Bords stricts */}
      <div className="md:hidden w-full bg-white border-b border-slate-300 px-4 py-3 flex justify-between items-center z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 text-blue-700 flex items-center justify-center font-black border border-blue-200">
            {profile?.prenom?.charAt(0) || <User size={20} />}
          </div>
          <div className="flex flex-col">
             <span className="text-sm font-black uppercase leading-tight">{profile?.prenom} {profile?.nom}</span>
             {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
                <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="text-xs text-slate-600 font-bold bg-transparent outline-none p-0 border-none cursor-pointer uppercase">
                  {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
             ) : (
                <span className="text-xs text-slate-500 font-bold flex items-center gap-1 uppercase"><MapPin size={10}/> {selectedStore || 'Magasin N/A'}</span>
             )}
          </div>
        </div>
        <button onClick={handleLogout} className="p-2 text-slate-400 border border-transparent hover:border-red-200 hover:text-red-600 transition-colors bg-slate-50"><LogOut size={20} /></button>
      </div>

      <nav className={`
        bg-white border-slate-300 flex z-50
        max-md:fixed max-md:bottom-0 max-md:w-full max-md:flex-row max-md:h-20 max-md:border-t max-md:justify-around max-md:items-center max-md:pb-2
        md:flex-col md:w-32 md:h-full md:border-r md:py-8 md:items-center md:justify-start md:gap-8
      `}>
        <div className="hidden md:flex flex-col items-center justify-center w-16 h-16 bg-blue-600 text-white shadow-lg shadow-blue-500/30 mb-8 border border-blue-700">
          <Package size={32} />
        </div>

        {/* Profil Desktop */}
        <div className="hidden md:flex flex-col items-center gap-2 mb-8 w-full px-2 border-b border-slate-200 pb-8">
          <div className="w-12 h-12 bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-black text-xl mb-1">
            {profile?.prenom?.charAt(0) || <User size={24} />}
          </div>
          <span className="text-xs font-black uppercase text-center w-full truncate px-2">{profile?.prenom}</span>
          {profile?.magasins_autorises && profile.magasins_autorises.length > 1 ? (
            <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-300 p-1 w-full outline-none mt-1 text-center uppercase">
              {profile.magasins_autorises.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <span className="text-[10px] font-bold text-slate-500 uppercase text-center flex items-center justify-center gap-1 mt-1 bg-slate-50 border border-slate-200 px-2 py-1 w-full"><MapPin size={10}/> {selectedStore || 'N/A'}</span>
          )}
          <button onClick={handleLogout} className="mt-4 p-2 text-slate-500 bg-slate-100 border border-slate-200 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-all w-full flex justify-center"><LogOut size={20} /></button>
        </div>

        <button onClick={() => { setActiveTab('scan'); if(viewState !== 'camera') resetToScan(); }} className={`flex flex-col items-center gap-1 p-2 border-2 transition-all ${activeTab === 'scan' ? 'border-blue-600 bg-blue-50 text-blue-700 scale-105' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:border-slate-200'}`}>
          <Camera size={28} strokeWidth={activeTab === 'scan' ? 2.5 : 2} />
          <span className="text-xs font-black uppercase tracking-wider">Scanner</span>
        </button>

        <button onClick={() => setActiveTab('history')} className={`flex flex-col items-center gap-1 p-2 border-2 transition-all ${activeTab === 'history' ? 'border-blue-600 bg-blue-50 text-blue-700 scale-105' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:border-slate-200'}`}>
          <History size={28} strokeWidth={activeTab === 'history' ? 2.5 : 2} />
          <span className="text-xs font-black uppercase tracking-wider">Historique</span>
        </button>
      </nav>

      {/* Suppression du rounded-l-[2.5rem] global */}
      <main className="flex-1 relative flex bg-slate-100 overflow-hidden h-full">
        <div className={`w-full h-full max-md:pb-20 ${activeTab === 'history' ? 'block' : 'hidden'}`}>
           {renderHistory()}
        </div>
        
        <div className={`w-full h-full max-md:pb-20 ${activeTab === 'scan' ? 'block' : 'hidden'}`}>
          {/* La caméra tourne en fond dans l'onglet scan, et le scanner reste actif */}
          {(viewState === 'camera' || viewState === 'product' || viewState === 'not-found') && renderCameraView()}
          {viewState === 'manual-entry' && renderManualEntry()}
          {viewState === 'take-photo' && renderTakePhoto()}
          {viewState === 'photo-preview' && renderPhotoPreview()}
        </div>

        {/* OVERLAYS GLOBAUX */}
        {viewState === 'product' && renderProductOverlay()}
        {viewState === 'not-found' && renderNotFoundOverlay()}
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scanline { 0% { transform: translateY(-120px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(120px); opacity: 0; } }
      `}} />
    </div>
  );
}