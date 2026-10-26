'use strict';
// Ported from The Third Eye (frontend/src/lib/music/types.ts, read 2026-10-26),
// types stripped by node:module, behaviour unchanged unless marked LIFECYCLE.
// Shared types for the multi-agent music pipeline.
//
// The pipeline is four cooperating "agents" (each a cascaded LLM call with a
// specialised role), grounded in a universal music knowledge base:
//   1. Musicologist — understands music worldwide/through history; turns the
//      raw request into a grounded MusicBrief (genre lineage, BPM, instruments,
//      structure, cultural context).
//   2. Beat-smith  — designs the arrangement/beats and the text-to-music model
//      prompt from the brief (BeatSpec).
//   3. Lyricist    — writes lyrics that fit the brief's structure & mood.
//   4. Conductor   — synchronises everything into one coherent FinalPlan
//      (prompt + tags + lyrics + duration), resolving any conflicts.

// Tempo range the Studio offers. Speedcore and extratone live up past 250.
const BPM_MIN = 40;
const BPM_MAX = 400;

                             
                                                                                         
                                                                                                   
                                                                                           
                                                            
                                                      
                          
                                                               
                        
 

/** A single genre's conventions in the knowledge base. */
                               
               
                 
                                                                                                
                                                                      
                        
                        
                    
                  
                                                                  
                                                                                 
                                                      
 

/** Musicologist output — the grounded brief the rest of the pipeline builds on. */
                             
                
                    
                 
              
              
                         
               
                        
                    
                  
                                  
                                                    
                             
                                                                                       
                          
 

/** Beat-smith output — the arrangement + the model prompt. */
                           
                                                    
                                                             
                          
                
                                                                   
 

/** Conductor output — the final, synchronised generation inputs. */
                            
                 
               
                                                
                        
                          
 

module.exports = { BPM_MIN, BPM_MAX };
