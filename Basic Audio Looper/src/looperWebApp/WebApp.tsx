import { useState,  useRef } from "react";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { ClipLoader } from "react-spinners";
import "./WebApp.css"

const CORE_VERSION = '0.12.6';
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const MAX_FILE_SIZE = 20* 1024 * 1024; // 20MB is the current limit 

const mimeToExt: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/webm': 'webm',
};

const WebApp = ()=>{
  const [option, setOption] = useState("Min Time");
  const [hourVal, setHourVal] = useState(0);
  const [minuteVal, setMinuteVal] = useState(0);
  const [secVal, setSecVal] = useState(0);
  const [currFile, setCurrFile] = useState<File | null>(null);
  const [originalDuration, setOriginalDuration] = useState<number>(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Deals with dragging for drag and drop box
  const dragDepth = useRef(0); // Use dragdepth to keep track of dragging over child elements
  const [isDragging, setIsDragging] = useState(false);


  // Load ffmpeg core once, lazily, on first use
  const getFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;

    const ffmpeg = new FFmpeg();
    // ffmpeg.on('log', ({ message }) => {
    //   console.log('[ffmpeg]', message);
    // });

    setStatus('loading');
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  function getAudioDuration(file: File): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();

      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration === Infinity) {
          // Recomputation duration if there are no proper duration header
          audio.currentTime = 1e101;
          audio.addEventListener('timeupdate', function handler() {
            audio.removeEventListener('timeupdate', handler);
            URL.revokeObjectURL(url);
            resolve(audio.duration);
          });
        } else {
          URL.revokeObjectURL(url);
          resolve(audio.duration);
        }
      }, { once: true });

      audio.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read audio metadata'));
      }, { once: true });

      audio.src = url;
    });
  }

  const audioLoadHandle = async (file:File) =>{
    setCurrFile(file);

    try{
      const dur = await getAudioDuration(file);
      setOriginalDuration(dur);
    }catch(err: unknown){
      if (err instanceof Error){
        setError(err.message);
      }else{
        setError("Error in getting duration of the audio.")
      }
      
    }
    
    
    setDownloadUrl(null);
    setStatus('idle');
    setError(null);

  }


  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;  // No longer dragging when file is dropped

    const droppedFiles = Array.from(e.dataTransfer.files);
    if(droppedFiles.length>1){
      setError("Only one audio file can be uploaded at a time!");
      return;
    }

    // make sure file is audio and it's not too large
    const file = droppedFiles[0]
    if (!file.type.startsWith("audio/")){
      setError("Only audio files are allowed to be uploaded!");
      return;
    }
    if (file.size>MAX_FILE_SIZE){
      setError("Uploaded file is too large!")
    }

    await audioLoadHandle(droppedFiles[0]);
  };


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0){
      return; // No file change for if there are no selected file 
    }
    const file = files[0]

    // Make sure the file is within limit
    if (file.size>MAX_FILE_SIZE){
      setError("Uploaded file is too large!");
      return;
    }

    await audioLoadHandle(file);
  };

  

  const handleLoop = async () => {
    const file = currFile;
    if (!file) return; // Do not loop empty file
    setError(null);
    setDownloadUrl(null);

    let ffmpeg, inputName, outputName;
    try{
      ffmpeg= await getFFmpeg();

      // Get file extensions using mime type as fallback
      const extension = (file.name.split('.').pop() || mimeToExt[file.type] || "").toLowerCase(); 
      if (!extension){
        throw new Error("Unable to determine file type.");
      }

      inputName = `input.${extension }`;
      outputName = `output.${extension }`;
    }catch (err:unknown) {
      if (err instanceof Error){
        setError(err.message);
        setStatus('error');
      }else{
        setError("Something went wrong.")
        
      }
      return;
    }

    // start looping using ffmpeg
    try {
      setStatus('loading');
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Find loop count
      let loopCount;
      if (option==="Max Time"){
        loopCount=Math.floor((hourVal*3600+minuteVal*60+secVal)/originalDuration);
      }else{
        loopCount=Math.ceil((hourVal*3600+minuteVal*60+secVal)/originalDuration);
      } 
      


      // -stream_loop N means "repeat N additional times" -> total plays = N+1
      await ffmpeg.exec([
        '-stream_loop', String(loopCount - 1),
        '-i', inputName,
        '-c', 'copy', // copy streams, no re-encode -> fast, lossless
        outputName,
      ]);

      const data = await ffmpeg.readFile(outputName);
      if (typeof data === 'string') throw new Error('Expected binary data');
      const bytes = new Uint8Array(data); 
      const blob = new Blob([bytes], { type: file.type });
      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);
      setStatus('done');
      

      // automatically download when it finishes
      triggerDownload(url, file.name);
    } catch (err:unknown) {
      if (err instanceof Error){
        setError(err.message);
        setStatus('error');
      }else{
        setError("Something went wrong.")
        
      }
    }finally{
      // clean up virtual file sys even for err
      try { 
        await ffmpeg.deleteFile(inputName); 
      } catch {
        console.warn(`Issue clean up ${inputName}`);
      }
      try { 
        await ffmpeg.deleteFile(outputName); 
      } catch {
        console.warn(`Issue clean up ${outputName}`);
      }
    }

  };


  // Drag and Drop
  const handleDivDragEnter = (e:React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
 
  const handleDivDragLeave = (e:React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };
 
  const handleDivDragOver = (e:React.DragEvent<HTMLDivElement>) => e.preventDefault();


  //const handleDivClick
  const handleDivClick = () => {
    fileInputRef.current?.click();
  };


  // Triggers download 
  const triggerDownload=(url:string, fileName:string)=>{
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a); 
    a.click();
    document.body.removeChild(a);
  }

  // Allow looping of another audio
  const goBack = ()=>{
    setStatus("idle");
    setCurrFile(null);
    setDownloadUrl(null);
    setError(null);
  }
  

  if (status==="loading"){
    return(
      <div className="appDiv">
        <ClipLoader size={100} color="#82C8E5" loading={status==="loading"}/>  
      </div>
    )
  }else if(status==="done"){
    return(
      <div className="appDiv">
        <h3>Operation Complete!</h3>

        <div className="downloadBtnRow">
          <button className="backBtn" onClick={goBack}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-arrow-left-icon lucide-arrow-left">
              <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
            </svg>
          </button>
          
          {(downloadUrl !== null && currFile) ?
            (<button className="downloadBtn" 
              onClick={()=>triggerDownload(downloadUrl, currFile?.name)}>
                Download Looped Audio
            </button>):null
          }
        </div>

        {/*Handle unexpected instance of status equal to done but the file and url is not proper*/}
        {(downloadUrl === null || !currFile)?
          (<div>
            <h3>Unexpected Error, Try Again!</h3> 
          </div>):null}
          
      </div>
    )
  }else if (status==="error"){
    <div className="appDiv">
        <h3>Error: ${error}</h3>
        <div>
          <button className="errBack" onClick={goBack}>
            Go Back
          </button>
          {/*Handle unexpected instance of status equal to done but the file and url is not proper*/}
        </div>
          {(downloadUrl !== null && currFile) ?
            (<button onClick={()=>triggerDownload(downloadUrl, currFile?.name)}>Download Looped Audio</button>):
            (<div>
              <h3>Unexpected Error, Try Again!</h3> 
            </div>)
          }
          
          
      </div>
  }


  return(
    <div className="appDiv">
      <div id="fileUploadSection">
        <div onDrop={handleFileDrop} onDragEnter={handleDivDragEnter}
          onDragLeave={handleDivDragLeave} 
          onDragOver={handleDivDragOver}
          onClick={handleDivClick}
          className={`dragDropDox ${isDragging? "dragStyle": "noDragStyle"}`}
        >
          <p style={{height:"1rem"}}> Drag and Drop or Click Here to Upload the Audio File</p>
          <input type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange}
            multiple={false} 
            accept={"audio/*"}
            style={{display:"none"}}/>
        </div>
        <div>
          <p style={{fontSize:"0.75rem"}}>
            Current Uploaded File: {currFile?currFile.name:"None"}
          </p>
        </div>
      </div>
      
      <section id="optionSelection">
        <h3 style={{margin:"0"}}>Looper Settings</h3>
        <div>
          <p>Duration Target Type</p>
          <label htmlFor="max-time">
            <input
              type="radio"
              id="max-time"
              name="option"
              value="Max Time"
              checked={option === "Max Time"}
              onChange={(e) => setOption(e.target.value)}
            />
            Max Time
          </label>
          <label htmlFor="min-time">
            <input
              type="radio"
              id="min-time"
              name="option"
              value="Min Time"
              checked={option === "Min Time"}
              onChange={(e) => setOption(e.target.value)}
            />
            Min Time
          </label>
        </div>
        <div>
          <p>Looped Audio Duration</p>

          <div className="durationSettings">
            
            <div className="durationInputPart">
              <label htmlFor="Hour" className="durationLabel">Hours</label>
              <input id="Hour" type="number" 
                min="0" 
                max="12" 
                value={hourVal}
                className="durationInput" 
                onChange={(e)=>{
                  if(Number(e.target.value) >= 12){
                    setHourVal(12);
                    setMinuteVal(0);
                    setSecVal(0);
                  }else if(Number(e.target.value)>=0){
                    setHourVal(Number(e.target.value));
                  }else{
                    setHourVal(0);
                  }
                }}/>
            </div>
            
            <div className="durationInputPart">
              <label htmlFor="Minutes" className="durationLabel">Minutes</label>
              <input 
                id="Minutes" 
                type="number" 
                min="0" 
                max="59" 
                value={minuteVal}
                className="durationInput"
                onChange={(e)=>{
                  if (hourVal >= 12){
                    setMinuteVal(0);
                  }else if(Number(e.target.value) > 59){
                    setMinuteVal(59);
                  }else if(Number(e.target.value)>=0){
                    setMinuteVal(Number(e.target.value));
                  }else{
                    setMinuteVal(0);
                  }
                }}/>
            </div>

            <div className="durationInputPart">
              <label htmlFor="Seconds" className="durationLabel">Seconds</label>
              <input 
                id="Seconds" 
                type="number" 
                min="0" 
                max="59" 
                className="durationInput"
                value={secVal}
                onChange={(e)=>{
                  if(hourVal>=12){
                    setSecVal(0);
                  }else if(Number(e.target.value) > 59){
                    setSecVal(59);
                  }else if(Number(e.target.value)>=0){
                    setSecVal(Number(e.target.value));
                  }else{
                    setSecVal(0);
                  }
                }}/>
            </div>

          </div>
          <p style={{fontSize:"0.675rem"}}>Max Duration: 12 hours</p>
        </div>
        
      </section>
      

      {error?(<p className="errorText">Error: ${error}</p>):(<></>)}

      <button className="submitBtn" disabled={!currFile} onClick={()=>handleLoop()}>
        <p style={{fontSize:"1rem"}}><b>Start Looping</b></p>
      </button>

      
    </div>
        
  )
}

export default WebApp;